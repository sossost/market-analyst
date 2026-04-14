import { db } from "@/db/client";
import {
  narrativeChains,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { asc, desc, eq, inArray, isNull, and, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sendDiscordMessage } from "@/lib/discord";
import type { Thesis } from "@/types/debate";
import {
  runSectorAlphaGate,
  STRUCTURAL_OBSERVATION_TAG,
} from "@/tools/sectorAlphaGate";
import { getActiveMetaRegimes, extractKeywords } from "@/debate/metaRegimeService";

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
  // megatrend and bottleneck will be identical (first sentence) — this is expected.
  // These theses will expire via timeframe and be replaced by new-style entries.
  const firstSentence = text.split(/[.\n]/)[0]?.trim() ?? text.slice(0, 100);
  return {
    megatrend: firstSentence,
    demandDriver: "",
    supplyChain: "",
    bottleneck: firstSentence,
    nextBottleneck: thesis.nextBottleneck ?? null,
    status,
    beneficiarySectors,
    beneficiaryTickers,
  };
}

/**
 * @deprecated Alias kept for backward compatibility with existing tests.
 * Use buildChainFields() for new code.
 */
export function parseBottleneckFromThesis(thesis: Thesis): BottleneckInfo | null {
  return buildChainFields(thesis);
}

interface MetaRegimeMatch {
  id: number;
}

/**
 * Find the best-matching active meta-regime for a given megatrend string.
 * Computes keyword overlap between the chain's megatrend and each regime's
 * name + description. Returns the regime with the highest overlap if it
 * meets MIN_KEYWORD_OVERLAP, or null if no match is found.
 */
async function matchMetaRegimeForChain(
  megatrend: string,
): Promise<MetaRegimeMatch | null> {
  const activeRegimes = await getActiveMetaRegimes();
  if (activeRegimes.length === 0) return null;

  const chainKeywords = extractKeywords(megatrend);

  let bestMatch: { id: number; overlap: number } | null = null;

  for (const regime of activeRegimes) {
    const regimeKeywords = extractKeywords(
      regime.name + " " + (regime.description ?? ""),
    );

    let overlap = 0;
    for (const kw of chainKeywords) {
      if (regimeKeywords.has(kw)) overlap++;
    }

    if (
      overlap >= MIN_KEYWORD_OVERLAP &&
      (bestMatch == null || overlap > bestMatch.overlap)
    ) {
      bestMatch = { id: regime.id, overlap };
    }
  }

  if (bestMatch == null) return null;
  return { id: bestMatch.id };
}

/**
 * Count chains already linked to the given meta-regime.
 * Used to assign a 1-based sequenceOrder for a newly linked chain.
 */
async function countChainsInMetaRegime(regimeId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(narrativeChains)
    .where(eq(narrativeChains.metaRegimeId, regimeId));
  return row?.count ?? 0;
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

const MIN_KEYWORD_OVERLAP = 2;

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

      // metaRegimeId가 없는 기존 체인에 대해 국면 재매칭 시도
      let regimeUpdateForExisting: { metaRegimeId: number; sequenceOrder: number } | null = null;
      if (existing.metaRegimeId == null) {
        try {
          const regimeMatch = await matchMetaRegimeForChain(info.megatrend);
          if (regimeMatch != null) {
            const existingCount = await countChainsInMetaRegime(regimeMatch.id);
            regimeUpdateForExisting = {
              metaRegimeId: regimeMatch.id,
              sequenceOrder: existingCount + 1,
            };
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
            ...(regimeUpdateForExisting != null && regimeUpdateForExisting),
            ...nextBeneficiaryUpdate,
          })
          .where(eq(narrativeChains.id, existing.id));
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
            ...(regimeUpdateForExisting != null && regimeUpdateForExisting),
            ...nextBeneficiaryUpdate,
          })
          .where(eq(narrativeChains.id, existing.id));
      }

      const regimeTag = regimeUpdateForExisting != null
        ? `, metaRegimeId: ${regimeUpdateForExisting.metaRegimeId}, seq: ${regimeUpdateForExisting.sequenceOrder}`
        : "";
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
        } else if (nextBeneficiaryTickers.length === 0) {
          // 상속 실패 + nextBeneficiary도 없음 → 빈 껍데기 chain 재생산 방지
          logger.warn(
            "NarrativeChain",
            `beneficiary_tickers 없어 chain 생성 거부 (thesis #${thesisId}, megatrend: ${info.megatrend})`,
          );
          return;
        }
      }

      // 새 체인을 메타 레짐과 자동 연결
      let metaRegimeId: number | null = null;
      let sequenceOrder: number | null = null;
      try {
        const regimeMatch = await matchMetaRegimeForChain(info.megatrend);
        if (regimeMatch != null) {
          metaRegimeId = regimeMatch.id;
          const existingCount = await countChainsInMetaRegime(regimeMatch.id);
          sequenceOrder = existingCount + 1;
        }
      } catch (regimeErr) {
        const reason = regimeErr instanceof Error ? regimeErr.message : String(regimeErr);
        logger.warn(
          "NarrativeChain",
          `Meta-regime matching failed for new chain (thesis #${thesisId}), proceeding without link: ${reason}`,
        );
      }

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
          ...(metaRegimeId != null && { metaRegimeId, sequenceOrder }),
          ...(alphaCompatible != null && { alphaCompatible }),
          ...(nextBeneficiarySectors.length > 0 && { nextBeneficiarySectors }),
          ...(nextBeneficiaryTickers.length > 0 && { nextBeneficiaryTickers }),
        })
        .returning({ id: narrativeChains.id });

      const regimeTag = metaRegimeId != null ? `, metaRegimeId: ${metaRegimeId}, seq: ${sequenceOrder}` : "";
      logger.info(
        "NarrativeChain",
        `Created chain #${result[0]?.id} for "${info.bottleneck}" (megatrend: ${info.megatrend}${alphaCompatible === false ? `, ${STRUCTURAL_OBSERVATION_TAG}` : ""}${regimeTag})`,
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
 * metaRegimeId가 NULL이고 ACTIVE/RESOLVING 상태인 체인 목록 조회.
 * 메타 레짐 자동 연결/생성 평가 대상 체인.
 */
export async function getUnlinkedActiveChains(): Promise<Array<{
  id: number;
  megatrend: string;
  bottleneck: string;
  status: string;
}>> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  return db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
      status: narrativeChains.status,
    })
    .from(narrativeChains)
    .where(
      and(
        isNull(narrativeChains.metaRegimeId),
        inArray(narrativeChains.status, activeStatuses),
      ),
    )
    .orderBy(asc(narrativeChains.id));
}
