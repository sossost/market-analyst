import { db } from "@/db/client";
import {
  narrativeChains,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { eq, inArray } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sendDiscordMessage } from "@/lib/discord";
import type { Thesis } from "@/types/debate";
import {
  runSectorAlphaGate,
  STRUCTURAL_OBSERVATION_TAG,
} from "@/tools/sectorAlphaGate";

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

/** Stop words filtered out during keyword extraction for chain matching. */
const STOP_WORDS = new Set([
  "의", "에", "에서", "로", "으로", "가", "이", "을", "를", "는", "은", "과", "와", "및",
  "중", "후", "내", "기준", "현재", "상태", "상승", "하락", "유지", "전환", "진입",
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "is", "are", "was", "were",
  "active", "resolving", "resolved",
]);

/**
 * Extract significant keywords from text for matching.
 * Filters out common stop words and short tokens.
 */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zA-Z가-힣0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
  );
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

    // TODO(#608-followup): thesis.nextBeneficiarySectors / nextBeneficiaryTickers는
    // Thesis 타입에 존재하지만 narrative_chains 테이블에 컬럼 미추가 상태.
    // DB 마이그레이션 후 여기서 저장 필요.

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
          })
          .where(eq(narrativeChains.id, existing.id));
      }

      logger.info(
        "NarrativeChain",
        `Updated chain #${existing.id} (status: ${info.status}, theses: ${updatedThesisIds.length}${alphaCompatible === false ? `, ${STRUCTURAL_OBSERVATION_TAG}` : ""})`,
      );
    } else {
      // Create new chain
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
          beneficiarySectors: info.beneficiarySectors,
          beneficiaryTickers: info.beneficiaryTickers,
          linkedThesisIds: [thesisId],
          ...(alphaCompatible != null && { alphaCompatible }),
        })
        .returning({ id: narrativeChains.id });

      logger.info(
        "NarrativeChain",
        `Created chain #${result[0]?.id} for "${info.bottleneck}" (megatrend: ${info.megatrend}${alphaCompatible === false ? `, ${STRUCTURAL_OBSERVATION_TAG}` : ""})`,
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
