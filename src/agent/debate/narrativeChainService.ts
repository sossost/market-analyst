import { db } from "../../db/client.js";
import {
  narrativeChains,
  type NarrativeChainStatus,
} from "../../db/schema/analyst.js";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../logger.js";
import type { Thesis } from "../../types/debate.js";

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
    beneficiarySectors: [],
    beneficiaryTickers: [],
  };
}

function extractField(text: string, keyword: string): string | null {
  // Match patterns like "메가트렌드: AI 인프라" or "bottleneck: 광트랜시버"
  const patterns = [
    new RegExp(`${keyword}[:\\s]+([^\\n.]+)`, "i"),
  ];
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
export async function findMatchingChain(
  megatrend: string,
  bottleneck: string,
): Promise<{ id: number; linkedThesisIds: number[] } | null> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  const candidates = await db
    .select({
      id: narrativeChains.id,
      bottleneck: narrativeChains.bottleneck,
      linkedThesisIds: narrativeChains.linkedThesisIds,
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

    if (existing != null) {
      // Update existing chain
      const updatedThesisIds = [...new Set([...existing.linkedThesisIds, thesisId])];
      const updateData: Record<string, unknown> = {
        linkedThesisIds: updatedThesisIds,
      };

      // Status transition
      if (info.status !== "ACTIVE") {
        updateData.status = info.status;
      }

      // Record resolution date for terminal states
      const isResolved = info.status === "RESOLVED" || info.status === "OVERSUPPLY";
      if (isResolved) {
        const now = new Date();
        updateData.bottleneckResolvedAt = now;

        // Fetch identified_at to calculate resolution_days
        const chain = await db
          .select({ bottleneckIdentifiedAt: narrativeChains.bottleneckIdentifiedAt })
          .from(narrativeChains)
          .where(eq(narrativeChains.id, existing.id))
          .limit(1);

        if (chain[0] != null) {
          updateData.resolutionDays = calculateResolutionDays(
            chain[0].bottleneckIdentifiedAt,
            now,
          );
        }
      }

      if (info.nextBottleneck != null) {
        updateData.nextBottleneck = info.nextBottleneck;
      }

      await db
        .update(narrativeChains)
        .set(updateData)
        .where(eq(narrativeChains.id, existing.id));

      logger.info(
        "NarrativeChain",
        `Updated chain #${existing.id} (status: ${info.status}, theses: ${updatedThesisIds.length})`,
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
        })
        .returning({ id: narrativeChains.id });

      logger.info(
        "NarrativeChain",
        `Created chain #${result[0]?.id} for "${info.bottleneck}" (megatrend: ${info.megatrend})`,
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
