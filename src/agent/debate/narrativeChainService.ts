import { db } from "../../db/client.js";
import {
  narrativeChains,
  type NarrativeChainStatus,
} from "../../db/schema/analyst.js";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../logger.js";
import type { Thesis } from "../../types/debate.js";
import {
  runSectorAlphaGate,
  STRUCTURAL_OBSERVATION_TAG,
} from "../tools/sectorAlphaGate.js";

/**
 * Jaccard word similarity between two strings.
 * Splits on whitespace, computes |intersection| / |union|.
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

const SIMILARITY_THRESHOLD = 0.7;

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
 * Parse bottleneck info from thesis text and fields.
 * The thesis text is expected to contain structured narrative content.
 * Status keywords in the thesis text trigger chain status transitions.
 */
export function parseBottleneckFromThesis(thesis: Thesis): BottleneckInfo | null {
  const text = thesis.thesis;
  if (text == null || text === "") return null;

  // Extract status from thesis text
  let status: NarrativeChainStatus = "ACTIVE";
  const upperText = text.toUpperCase();
  if (upperText.includes("OVERSUPPLY") || upperText.includes("공급 과잉")) {
    status = "OVERSUPPLY";
  } else if (upperText.includes("RESOLVED") || upperText.includes("병목 해소")) {
    status = "RESOLVED";
  } else if (upperText.includes("RESOLVING") || upperText.includes("해소 진행")) {
    status = "RESOLVING";
  }

  // Use thesis text as the primary source — parse key fields
  // These are best-effort extractions; LLM output varies
  return {
    megatrend: extractField(text, "megatrend") ?? extractFirstSentence(text),
    demandDriver: extractField(text, "demand") ?? "",
    supplyChain: extractField(text, "supply") ?? "",
    bottleneck: extractField(text, "bottleneck") ?? extractFirstSentence(text),
    nextBottleneck: thesis.nextBottleneck ?? null,
    status,
    beneficiarySectors: Array.isArray(thesis.beneficiarySectors) && thesis.beneficiarySectors.length > 0
      ? thesis.beneficiarySectors
      : [],
    beneficiaryTickers: Array.isArray(thesis.beneficiaryTickers) && thesis.beneficiaryTickers.length > 0
      ? thesis.beneficiaryTickers
      : [],
  };
}

type FieldKeyword = "megatrend" | "demand" | "supply" | "bottleneck";

const FIELD_PATTERNS: Record<FieldKeyword, RegExp[]> = {
  megatrend: [/메가트렌드[:\s]+([^\n.]+)/i, /megatrend[:\s]+([^\n.]+)/i],
  demand: [/수요[:\s]+([^\n.]+)/i, /demand[:\s]+([^\n.]+)/i],
  supply: [/공급망[:\s]+([^\n.]+)/i, /supply[:\s]+([^\n.]+)/i],
  bottleneck: [/병목[:\s]+([^\n.]+)/i, /bottleneck[:\s]+([^\n.]+)/i],
};

function extractField(text: string, keyword: FieldKeyword): string | null {
  const patterns = FIELD_PATTERNS[keyword];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] != null) {
      return match[1].trim();
    }
  }
  return null;
}

function extractFirstSentence(text: string): string {
  const sentence = text.split(/[.\n]/)[0];
  return sentence?.trim() ?? text.slice(0, 100);
}

/**
 * Find an existing active chain with the same megatrend and similar bottleneck.
 */
interface MatchingChain {
  id: number;
  linkedThesisIds: number[];
  bottleneckIdentifiedAt: Date;
}

export async function findMatchingChain(
  megatrend: string,
  bottleneck: string,
): Promise<MatchingChain | null> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  const candidates = await db
    .select({
      id: narrativeChains.id,
      bottleneck: narrativeChains.bottleneck,
      linkedThesisIds: narrativeChains.linkedThesisIds,
      bottleneckIdentifiedAt: narrativeChains.bottleneckIdentifiedAt,
    })
    .from(narrativeChains)
    .where(
      and(
        eq(narrativeChains.megatrend, megatrend),
        inArray(narrativeChains.status, activeStatuses),
      ),
    );

  for (const candidate of candidates) {
    const similarity = jaccardSimilarity(candidate.bottleneck, bottleneck);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return {
        id: candidate.id,
        linkedThesisIds: (candidate.linkedThesisIds as number[]) ?? [],
        bottleneckIdentifiedAt: candidate.bottleneckIdentifiedAt,
      };
    }
  }

  return null;
}

/**
 * Calculate resolution_days from identified_at to resolved_at.
 */
function calculateResolutionDays(
  identifiedAt: Date,
  resolvedAt: Date,
): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (resolvedAt.getTime() - identifiedAt.getTime()) / msPerDay,
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

    const info = parseBottleneckFromThesis(thesis);
    if (info == null) {
      logger.warn("NarrativeChain", `Could not parse bottleneck from thesis #${thesisId}`);
      return;
    }

    const existing = await findMatchingChain(info.megatrend, info.bottleneck);

    // Sector Alpha Gate — 수혜 섹터 SEPA 적합성 평가
    const alphaGateResult = info.beneficiarySectors.length > 0
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
  }
}
