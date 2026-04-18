import { db } from "@/db/client";
import {
  narrativeChains,
  narrativeChainRegimes,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { asc, desc, eq, inArray, isNull, and, sql, notInArray } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sendDiscordMessage } from "@/lib/discord";
import type { Thesis } from "@/types/debate";
import {
  runSectorAlphaGate,
  STRUCTURAL_OBSERVATION_TAG,
} from "@/tools/sectorAlphaGate";
import { getActiveMetaRegimes, extractKeywords } from "@/debate/metaRegimeService";
import { ClaudeCliProvider } from "@/debate/llm/claudeCliProvider";

const MIN_KEYWORD_OVERLAP = 3;

/** LLM 메타 레짐 링킹에 사용하는 모델 — 단순 분류 작업이므로 Haiku 우선 */
const LLM_LINKING_MODEL = "claude-haiku-4-5";

/**
 * Jaccard word similarity between two strings.
 * Splits on whitespace, computes |intersection| / |union|.
 *
 * @deprecated Used only for legacy test compatibility. New matching uses extractKeywords().
 */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersectionSize++;
    }
  }

  const unionSize = wordsA.size + wordsB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

/**
 * Extract bottleneck-related info from a structural_narrative thesis.
 * Returns null if the thesis doesn't contain bottleneck-relevant content.
 */
interface BottleneckInfo {
  megatrend: string;
  demandDriver: string;
  supplyChain: string;
  bottleneck: string;
  nextBottleneck: string | null;
  status: NarrativeChainStatus;
  beneficiarySectors: string[];
  beneficiaryTickers: string[];
}

/**
 * Build BottleneckInfo from a thesis.
 *
 * If the thesis has a structured narrativeChain field (new-style thesis from
 * round 3 synthesis), those values are used directly.
 * Otherwise falls back to extracting the first sentence as a best-effort proxy
 * (legacy thesis with no structured fields).
 *
 * Status is always derived from keyword detection in the thesis text.
 */
export function buildChainFields(thesis: Thesis): BottleneckInfo | null {
  const text = thesis.thesis;
  if (text == null || text === "") return null;

  // Extract status from thesis text.
  // Guard against false positives: "병목 해소 신호 0건" means NOT resolved.
  // negationPattern applies to both "병목 해소" (Korean) and "RESOLVED" (English),
  // because LLM may mix "RESOLVED" with Korean negation context.
  let status: NarrativeChainStatus = "ACTIVE";
  const upperText = text.toUpperCase();
  const hasNegation = /병목\s*해소.{0,8}(0건|없|아직|미확인|신호|zero)/i.test(text);
  if (upperText.includes("OVERSUPPLY") || upperText.includes("공급 과잉")) {
    status = "OVERSUPPLY";
  } else if (
    !hasNegation &&
    (upperText.includes("RESOLVED") || text.includes("병목 해소"))
  ) {
    status = "RESOLVED";
  } else if (upperText.includes("RESOLVING") || upperText.includes("해소 진행")) {
    status = "RESOLVING";
  }

  const beneficiarySectors = Array.isArray(thesis.beneficiarySectors)
    ? thesis.beneficiarySectors
    : [];
  const beneficiaryTickers = Array.isArray(thesis.beneficiaryTickers)
    ? thesis.beneficiaryTickers
    : [];

  // New-style thesis: narrativeChain is populated by LLM
  if (thesis.narrativeChain != null) {
    return {
      megatrend: thesis.narrativeChain.megatrend,
      demandDriver: thesis.narrativeChain.demandDriver,
      supplyChain: thesis.narrativeChain.supplyChain,
      bottleneck: thesis.narrativeChain.bottleneck,
      nextBottleneck: thesis.nextBottleneck ?? null,
      status,
      beneficiarySectors,
      beneficiaryTickers,
    };
  }

  // Legacy fallback: thesis created before narrativeChain prompt was added.
  // These produce megatrend === bottleneck with empty demandDriver/supplyChain,
  // which causes false-positive keyword matching. Reject to prevent corrupted chains.
  // Legacy theses will expire via timeframe and be replaced by new-style entries.
  return null;
}

/**
 * @deprecated Alias kept for backward compatibility with existing tests.
 * Use buildChainFields() for new code.
 */
export function parseBottleneckFromThesis(thesis: Thesis): BottleneckInfo | null {
  return buildChainFields(thesis);
}

/**
 * LLM을 사용하여 신규 체인이 속하는 활성 국면 ID 목록을 반환한다.
 *
 * 키워드 알고리즘 대체 — 동의어/표현 변형("에너지" vs "전력")을 LLM이 의미적으로 처리한다.
 * 복수 국면 반환 허용. 파싱 실패 시 [] 반환으로 안전 강등.
 */
async function matchMetaRegimesForChainViaLLM(
  megatrend: string,
  bottleneck: string,
  demandDriver: string,
): Promise<number[]> {
  const activeRegimes = await getActiveMetaRegimes();
  if (activeRegimes.length === 0) return [];

  // 각 국면의 연결 체인 요약을 조회하여 LLM에 컨텍스트로 제공
  const regimeIds = activeRegimes.map((r) => r.id);
  const linkedChains = await db
    .select({
      regimeId: narrativeChainRegimes.regimeId,
      bottleneck: narrativeChains.bottleneck,
    })
    .from(narrativeChainRegimes)
    .innerJoin(narrativeChains, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(inArray(narrativeChainRegimes.regimeId, regimeIds));

  const chainsByRegime = new Map<number, string[]>();
  for (const chain of linkedChains) {
    const existing = chainsByRegime.get(chain.regimeId) ?? [];
    existing.push(chain.bottleneck);
    chainsByRegime.set(chain.regimeId, existing);
  }

  const regimeList = activeRegimes
    .map((r) => {
      const chains = chainsByRegime.get(r.id) ?? [];
      const chainSummary =
        chains.length > 0
          ? `\n    연결 체인: ${chains.slice(0, 3).join(", ")}`
          : "";
      const desc = r.description != null ? ` — ${r.description}` : "";
      return `  ${r.id}: ${r.name}${desc}${chainSummary}`;
    })
    .join("\n");

  const systemPrompt =
    "당신은 금융 서사 분석가입니다. 간결하고 정확한 JSON만 반환하세요. 설명이나 마크다운 없이 순수 JSON만 출력하세요.";

  const userMessage = `아래 내러티브 체인이 어떤 국면에 속하는지 판단하세요.

[신규 체인]
- 메가트렌드: ${megatrend}
- 병목: ${bottleneck}
- 수요 동인: ${demandDriver}

[활성 국면 목록]
${regimeList}

위 국면 중 이 체인이 속하는 국면의 ID를 JSON 배열로 반환하세요.
없으면 빈 배열. 복수 가능.
예시: {"regimeIds": [1, 3]} 또는 {"regimeIds": []}`;

  try {
    const provider = new ClaudeCliProvider(LLM_LINKING_MODEL);
    const result = await provider.call({ systemPrompt, userMessage });

    const text = result.content.trim();
    if (text === "") {
      logger.warn("NarrativeChain", `LLM 링킹 빈 응답 (megatrend: ${megatrend})`);
      return [];
    }

    // JSON 블록 추출 (```json ... ``` 형식 대응)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch == null) {
      logger.warn("NarrativeChain", `LLM 링킹 JSON 추출 실패 (megatrend: ${megatrend}): ${text.slice(0, 100)}`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      !("regimeIds" in parsed) ||
      !Array.isArray((parsed as Record<string, unknown>).regimeIds)
    ) {
      logger.warn("NarrativeChain", `LLM 링킹 응답 구조 불일치 (megatrend: ${megatrend}): ${text.slice(0, 100)}`);
      return [];
    }

    const rawIds = (parsed as { regimeIds: unknown[] }).regimeIds;
    const validIds = rawIds.filter((id): id is number => typeof id === "number");

    // 실제 존재하는 활성 국면 ID만 필터링
    const activeRegimeIdSet = new Set(activeRegimes.map((r) => r.id));
    return validIds.filter((id) => activeRegimeIdSet.has(id));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("NarrativeChain", `LLM 링킹 실패 (megatrend: ${megatrend}): ${reason}`);
    return [];
  }
}

/**
 * junction table 기준으로 특정 국면에 연결된 체인 수를 반환한다.
 * 신규 링크 시 sequence_order 계산에 사용된다.
 */
async function countChainsInMetaRegime(regimeId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(narrativeChainRegimes)
    .where(eq(narrativeChainRegimes.regimeId, regimeId));
  return row?.count ?? 0;
}

/**
 * junction table에 체인-국면 링크를 삽입한다.
 * 이미 존재하는 링크는 무시한다 (ON CONFLICT DO NOTHING).
 */
async function insertChainRegimeLink(
  chainId: number,
  regimeId: number,
  sequenceOrder: number,
  sequenceConfidence: "low" | "medium" | "high" = "medium",
): Promise<void> {
  await db
    .insert(narrativeChainRegimes)
    .values({
      chainId,
      regimeId,
      sequenceOrder,
      sequenceConfidence,
    })
    .onConflictDoNothing();
}

/**
 * Find an existing active chain matching the given bottleneck info.
 * Uses keyword overlap on megatrend + bottleneck combined text.
 * Requires at least MIN_KEYWORD_OVERLAP keywords in common.
 */
interface MatchingChain {
  id: number;
  linkedThesisIds: number[];
  bottleneckIdentifiedAt: Date;
  metaRegimeId: number | null;
}

export async function findMatchingChain(
  input: { megatrend: string; bottleneck: string },
): Promise<MatchingChain | null> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  const candidates = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
      linkedThesisIds: narrativeChains.linkedThesisIds,
      bottleneckIdentifiedAt: narrativeChains.bottleneckIdentifiedAt,
      metaRegimeId: narrativeChains.metaRegimeId,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.status, activeStatuses));

  const newKeywords = extractKeywords(input.megatrend + " " + input.bottleneck);

  let bestMatch: { candidate: (typeof candidates)[0]; overlap: number } | null = null;

  for (const candidate of candidates) {
    const existingKeywords = extractKeywords(
      candidate.megatrend + " " + candidate.bottleneck,
    );

    let overlap = 0;
    for (const kw of newKeywords) {
      if (existingKeywords.has(kw)) overlap++;
    }

    if (
      overlap >= MIN_KEYWORD_OVERLAP &&
      (bestMatch == null || overlap > bestMatch.overlap)
    ) {
      bestMatch = { candidate, overlap };
    }
  }

  if (bestMatch == null) return null;

  return {
    id: bestMatch.candidate.id,
    linkedThesisIds: (bestMatch.candidate.linkedThesisIds as number[]) ?? [],
    bottleneckIdentifiedAt: bestMatch.candidate.bottleneckIdentifiedAt,
    metaRegimeId: bestMatch.candidate.metaRegimeId ?? null,
  };
}

interface ChainBeneficiary {
  beneficiarySectors: string[];
  beneficiaryTickers: string[];
}

/**
 * Find the most recently created ACTIVE/RESOLVING chain with matching megatrend
 * keywords that has non-empty beneficiary data.
 *
 * Used as a fallback when a new chain is being inserted with empty beneficiary
 * fields — inherits from the closest existing chain in the same narrative thread.
 */
async function findBeneficiaryFromSameNarrative(
  megatrend: string,
): Promise<ChainBeneficiary | null> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  const candidates = await db
    .select({
      megatrend: narrativeChains.megatrend,
      beneficiarySectors: narrativeChains.beneficiarySectors,
      beneficiaryTickers: narrativeChains.beneficiaryTickers,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.status, activeStatuses))
    .orderBy(desc(narrativeChains.bottleneckIdentifiedAt));

  const newKeywords = extractKeywords(megatrend);

  let bestMatch: {
    beneficiarySectors: string[];
    beneficiaryTickers: string[];
    overlap: number;
  } | null = null;

  for (const candidate of candidates) {
    const sectors = (candidate.beneficiarySectors as string[] | null) ?? [];
    const tickers = (candidate.beneficiaryTickers as string[] | null) ?? [];
    const hasBeneficiaryData = sectors.length > 0 || tickers.length > 0;
    if (!hasBeneficiaryData) continue;

    const existingKeywords = extractKeywords(candidate.megatrend);

    let overlap = 0;
    for (const kw of newKeywords) {
      if (existingKeywords.has(kw)) overlap++;
    }

    if (
      overlap >= MIN_KEYWORD_OVERLAP &&
      (bestMatch == null || overlap > bestMatch.overlap)
    ) {
      bestMatch = { beneficiarySectors: sectors, beneficiaryTickers: tickers, overlap };
    }
  }

  if (bestMatch == null) return null;

  return {
    beneficiarySectors: bestMatch.beneficiarySectors,
    beneficiaryTickers: bestMatch.beneficiaryTickers,
  };
}

/**
 * Calculate resolution_days from identified_at to resolved_at.
 */
function calculateResolutionDays(
  identifiedAt: Date,
  resolvedAt: Date,
): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round(
    (resolvedAt.getTime() - identifiedAt.getTime()) / MS_PER_DAY,
  );
}

/**
 * Record or update a narrative chain based on a saved thesis.
 * Called after thesis storage; failure is isolated (logged, not thrown).
 */
export async function recordNarrativeChain(
  thesis: Thesis,
  thesisId: number,
): Promise<void> {
  try {
    if (thesis.category !== "structural_narrative") return;

    const info = buildChainFields(thesis);
    if (info == null) {
      logger.warn("NarrativeChain", `Could not parse bottleneck from thesis #${thesisId}`);
      return;
    }

    const existing = await findMatchingChain({ megatrend: info.megatrend, bottleneck: info.bottleneck });

    // N+1 병목 수혜 섹터/종목 (#735 — #608-followup 해결)
    const nextBeneficiarySectors = Array.isArray(thesis.nextBeneficiarySectors)
      ? thesis.nextBeneficiarySectors
      : [];
    const nextBeneficiaryTickers = Array.isArray(thesis.nextBeneficiaryTickers)
      ? thesis.nextBeneficiaryTickers
      : [];

    // Sector Alpha Gate — 수혜 섹터 SEPA 적합성 평가
    const alphaGateResult =
      info.beneficiarySectors.length > 0
        ? await runSectorAlphaGate(info.beneficiarySectors)
        : null;

    const alphaCompatible = alphaGateResult?.alphaCompatible ?? null;

    if (existing != null) {
      // Update existing chain
      const updatedThesisIds = [...new Set([...existing.linkedThesisIds, thesisId])];

      const isResolved = info.status === "RESOLVED" || info.status === "OVERSUPPLY";

      // N+1 수혜 필드 (비어있지 않을 때만 업데이트)
      const nextBeneficiaryUpdate = {
        ...(nextBeneficiarySectors.length > 0 && { nextBeneficiarySectors }),
        ...(nextBeneficiaryTickers.length > 0 && { nextBeneficiaryTickers }),
      };

      // junction table에 미연결된 기존 체인에 대해 국면 재매칭 시도
      const existingLinks = await db
        .select({ regimeId: narrativeChainRegimes.regimeId })
        .from(narrativeChainRegimes)
        .where(eq(narrativeChainRegimes.chainId, existing.id));

      const isUnlinked = existingLinks.length === 0;
      let regimeLinkedForExisting = false;

      if (isUnlinked) {
        try {
          const regimeIds = await matchMetaRegimesForChainViaLLM(
            info.megatrend,
            info.bottleneck,
            info.demandDriver,
          );
          for (const regimeId of regimeIds) {
            const existingCount = await countChainsInMetaRegime(regimeId);
            await insertChainRegimeLink(existing.id, regimeId, existingCount + 1);
            regimeLinkedForExisting = true;
          }
        } catch (regimeErr) {
          const reason = regimeErr instanceof Error ? regimeErr.message : String(regimeErr);
          logger.warn(
            "NarrativeChain",
            `Meta-regime re-matching failed for existing chain #${existing.id} (thesis #${thesisId}): ${reason}`,
          );
        }
      }

      if (isResolved) {
        const now = new Date();
        const resolutionDays = calculateResolutionDays(
          existing.bottleneckIdentifiedAt,
          now,
        );

        await db
          .update(narrativeChains)
          .set({
            linkedThesisIds: updatedThesisIds,
            status: info.status,
            bottleneckResolvedAt: now,
            resolutionDays,
            ...(info.nextBottleneck != null && { nextBottleneck: info.nextBottleneck }),
            ...(info.beneficiarySectors.length > 0 && { beneficiarySectors: info.beneficiarySectors }),
            ...(info.beneficiaryTickers.length > 0 && { beneficiaryTickers: info.beneficiaryTickers }),
            ...(alphaCompatible != null && { alphaCompatible }),
            ...nextBeneficiaryUpdate,
          })
          .where(eq(narrativeChains.id, existing.id));

        // RESOLVING/RESOLVED 상태이고 nextBottleneck이 있으면 다음 체인 승격 트리거
        if (info.nextBottleneck != null && info.nextBottleneck !== "") {
          await maybePromoteNextBottleneck(
            info.nextBottleneck,
            info.megatrend,
            info.demandDriver,
            info.beneficiarySectors,
            info.beneficiaryTickers,
            thesisId,
          );
        }
      } else {
        await db
          .update(narrativeChains)
          .set({
            linkedThesisIds: updatedThesisIds,
            ...(info.status !== "ACTIVE" && { status: info.status }),
            ...(info.nextBottleneck != null && { nextBottleneck: info.nextBottleneck }),
            ...(info.beneficiarySectors.length > 0 && { beneficiarySectors: info.beneficiarySectors }),
            ...(info.beneficiaryTickers.length > 0 && { beneficiaryTickers: info.beneficiaryTickers }),
            ...(alphaCompatible != null && { alphaCompatible }),
            ...nextBeneficiaryUpdate,
          })
          .where(eq(narrativeChains.id, existing.id));

        // RESOLVING 상태이고 nextBottleneck이 있으면 다음 체인 승격 트리거
        if (
          info.status === "RESOLVING" &&
          info.nextBottleneck != null &&
          info.nextBottleneck !== ""
        ) {
          await maybePromoteNextBottleneck(
            info.nextBottleneck,
            info.megatrend,
            info.demandDriver,
            info.beneficiarySectors,
            info.beneficiaryTickers,
            thesisId,
          );
        }
      }

      const regimeTag = regimeLinkedForExisting ? " (regime linked)" : "";
      logger.info(
        "NarrativeChain",
        `Updated chain #${existing.id} (status: ${info.status}, theses: ${updatedThesisIds.length}${alphaCompatible === false ? `, ${STRUCTURAL_OBSERVATION_TAG}` : ""}${regimeTag})`,
      );
    } else {
      // Create new chain — if beneficiary is empty, attempt to inherit from
      // an existing chain in the same narrative thread (same megatrend keywords).
      let finalBeneficiarySectors = info.beneficiarySectors;
      let finalBeneficiaryTickers = info.beneficiaryTickers;

      const isBeneficiaryEmpty =
        info.beneficiarySectors.length === 0 && info.beneficiaryTickers.length === 0;

      if (isBeneficiaryEmpty) {
        const inherited = await findBeneficiaryFromSameNarrative(info.megatrend);
        if (inherited != null) {
          finalBeneficiarySectors = inherited.beneficiarySectors;
          finalBeneficiaryTickers = inherited.beneficiaryTickers;
          logger.info(
            "NarrativeChain",
            `Inherited beneficiary data for new chain (megatrend: ${info.megatrend}): sectors=${finalBeneficiarySectors.join(",")}, tickers=${finalBeneficiaryTickers.join(",")}`,
          );
        } else if (nextBeneficiaryTickers.length === 0 && nextBeneficiarySectors.length === 0) {
          // 상속 실패 + nextBeneficiary도 없음 → 빈 껍데기 chain 재생산 방지
          logger.warn(
            "NarrativeChain",
            `beneficiary_tickers 없어 chain 생성 거부 (thesis #${thesisId}, megatrend: ${info.megatrend})`,
          );
          return;
        }
      }

      // 신규 체인 생성 — metaRegimeId 없이 생성 후 junction table에 링크
      const result = await db
        .insert(narrativeChains)
        .values({
          megatrend: info.megatrend,
          demandDriver: info.demandDriver,
          supplyChain: info.supplyChain,
          bottleneck: info.bottleneck,
          bottleneckIdentifiedAt: new Date(),
          nextBottleneck: info.nextBottleneck,
          status: info.status,
          beneficiarySectors: finalBeneficiarySectors,
          beneficiaryTickers: finalBeneficiaryTickers,
          linkedThesisIds: [thesisId],
          ...(alphaCompatible != null && { alphaCompatible }),
          ...(nextBeneficiarySectors.length > 0 && { nextBeneficiarySectors }),
          ...(nextBeneficiaryTickers.length > 0 && { nextBeneficiaryTickers }),
        })
        .returning({ id: narrativeChains.id });

      const newChainId = result[0]?.id;
      let linkedRegimeIds: number[] = [];

      if (newChainId != null) {
        // LLM으로 국면 링킹 — 실패 시 체인 생성은 유지
        try {
          const regimeIds = await matchMetaRegimesForChainViaLLM(
            info.megatrend,
            info.bottleneck,
            info.demandDriver,
          );
          for (const regimeId of regimeIds) {
            const existingCount = await countChainsInMetaRegime(regimeId);
            await insertChainRegimeLink(newChainId, regimeId, existingCount + 1);
            linkedRegimeIds.push(regimeId);
          }
        } catch (regimeErr) {
          const reason = regimeErr instanceof Error ? regimeErr.message : String(regimeErr);
          logger.warn(
            "NarrativeChain",
            `Meta-regime matching failed for new chain (thesis #${thesisId}), proceeding without link: ${reason}`,
          );
        }
      }

      const regimeTag = linkedRegimeIds.length > 0
        ? `, regimes: [${linkedRegimeIds.join(",")}]`
        : "";
      logger.info(
        "NarrativeChain",
        `Created chain #${newChainId} for "${info.bottleneck}" (megatrend: ${info.megatrend}${alphaCompatible === false ? `, ${STRUCTURAL_OBSERVATION_TAG}` : ""}${regimeTag})`,
      );
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      "NarrativeChain",
      `Chain recording failed for thesis #${thesisId} (thesis saved successfully): ${reason}`,
    );
    await sendDiscordMessage(
      `⚠️ **[NarrativeChain 장애]** thesis #${thesisId} chain 연결 실패\n\`\`\`${reason}\`\`\``,
    ).catch(() => {
      // Discord 발송 실패는 무시 — 원본 오류 은폐 방지
    });
  }
}

/**
 * junction table에 미등록된 ACTIVE/RESOLVING 체인 목록 조회.
 * metaRegimeId 컬럼이 아닌 narrative_chain_regimes 테이블 기준으로 판단한다.
 */
export async function getUnlinkedActiveChains(): Promise<Array<{
  id: number;
  megatrend: string;
  bottleneck: string;
  status: string;
}>> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];

  // junction table에 row가 존재하는 체인 ID 집합을 먼저 조회
  const linkedRows = await db
    .select({ chainId: narrativeChainRegimes.chainId })
    .from(narrativeChainRegimes);

  const linkedChainIds = linkedRows.map((r) => r.chainId);

  const baseQuery = db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
      status: narrativeChains.status,
    })
    .from(narrativeChains)
    .orderBy(asc(narrativeChains.id));

  if (linkedChainIds.length === 0) {
    return baseQuery.where(inArray(narrativeChains.status, activeStatuses));
  }

  return baseQuery.where(
    and(
      inArray(narrativeChains.status, activeStatuses),
      notInArray(narrativeChains.id, linkedChainIds),
    ),
  );
}

/**
 * RESOLVING/RESOLVED 상태 체인의 nextBottleneck을 신규 체인으로 승격한다.
 * 중복 생성 방지: findMatchingChain으로 동일 bottleneck이 이미 존재하면 스킵한다.
 */
async function maybePromoteNextBottleneck(
  nextBottleneck: string,
  megatrend: string,
  demandDriver: string,
  beneficiarySectors: string[],
  beneficiaryTickers: string[],
  thesisId: number,
): Promise<void> {
  try {
    const alreadyExists = await findMatchingChain({
      megatrend,
      bottleneck: nextBottleneck,
    });

    if (alreadyExists != null) {
      logger.info(
        "NarrativeChain",
        `next_bottleneck 승격 스킵 — 동일 체인 이미 존재 (chain #${alreadyExists.id}, nextBottleneck: ${nextBottleneck})`,
      );
      return;
    }

    const result = await db
      .insert(narrativeChains)
      .values({
        megatrend,
        demandDriver,
        supplyChain: "",
        bottleneck: nextBottleneck,
        bottleneckIdentifiedAt: new Date(),
        status: "ACTIVE",
        beneficiarySectors,
        beneficiaryTickers,
        linkedThesisIds: [thesisId],
      })
      .returning({ id: narrativeChains.id });

    const newChainId = result[0]?.id;
    if (newChainId == null) return;

    // 신규 승격 체인도 LLM으로 국면 링킹 시도
    try {
      const regimeIds = await matchMetaRegimesForChainViaLLM(megatrend, nextBottleneck, demandDriver);
      for (const regimeId of regimeIds) {
        const existingCount = await countChainsInMetaRegime(regimeId);
        await insertChainRegimeLink(newChainId, regimeId, existingCount + 1);
      }
    } catch (regimeErr) {
      const reason = regimeErr instanceof Error ? regimeErr.message : String(regimeErr);
      logger.warn("NarrativeChain", `승격 체인 국면 링킹 실패 (chain #${newChainId}): ${reason}`);
    }

    logger.info(
      "NarrativeChain",
      `next_bottleneck 승격 완료 — 신규 체인 #${newChainId} (bottleneck: ${nextBottleneck}, megatrend: ${megatrend})`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("NarrativeChain", `next_bottleneck 승격 실패 (thesisId: ${thesisId}): ${reason}`);
  }
}
