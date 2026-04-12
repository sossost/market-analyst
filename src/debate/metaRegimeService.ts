import { db } from "@/db/client";
import {
  metaRegimes,
  narrativeChains,
  type MetaRegimePropagationType,
  type MetaRegimeStatus,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { eq, inArray, asc, isNull, and, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sanitizeCell } from "@/lib/markdown";

// ─── Types ──────────────────────────────────────────────────────────

export interface MetaRegimeInput {
  name: string;
  description?: string;
  propagationType: MetaRegimePropagationType;
  activatedAt?: Date;
}

export interface MetaRegimeWithChains {
  id: number;
  name: string;
  description: string | null;
  propagationType: MetaRegimePropagationType;
  status: MetaRegimeStatus;
  activatedAt: Date | null;
  peakAt: Date | null;
  chains: Array<{
    id: number;
    bottleneck: string;
    supplyChain: string;
    sequenceOrder: number | null;
    sequenceConfidence: string | null;
    status: string;
    activatedAt: Date | null;
    peakAt: Date | null;
  }>;
}

// ─── CRUD ───────────────────────────────────────────────────────────

export async function createMetaRegime(
  input: MetaRegimeInput,
): Promise<{ id: number }> {
  const [result] = await db
    .insert(metaRegimes)
    .values({
      name: input.name,
      description: input.description ?? null,
      propagationType: input.propagationType,
      activatedAt: input.activatedAt ?? new Date(),
    })
    .returning({ id: metaRegimes.id });

  if (result == null) {
    throw new Error(`Failed to insert meta-regime: no row returned for "${input.name}"`);
  }

  logger.info(
    "MetaRegime",
    `Created meta-regime #${result.id}: "${input.name}" (${input.propagationType})`,
  );

  return result;
}

export async function getActiveMetaRegimes(): Promise<
  Array<{
    id: number;
    name: string;
    description: string | null;
    propagationType: MetaRegimePropagationType;
    status: MetaRegimeStatus;
    activatedAt: Date | null;
    peakAt: Date | null;
  }>
> {
  const activeStatuses: MetaRegimeStatus[] = ["ACTIVE", "PEAKED"];
  return db
    .select({
      id: metaRegimes.id,
      name: metaRegimes.name,
      description: metaRegimes.description,
      propagationType: metaRegimes.propagationType,
      status: metaRegimes.status,
      activatedAt: metaRegimes.activatedAt,
      peakAt: metaRegimes.peakAt,
    })
    .from(metaRegimes)
    .where(inArray(metaRegimes.status, activeStatuses));
}

export async function getMetaRegimeWithChains(
  regimeId: number,
): Promise<MetaRegimeWithChains | null> {
  const [regime] = await db
    .select({
      id: metaRegimes.id,
      name: metaRegimes.name,
      description: metaRegimes.description,
      propagationType: metaRegimes.propagationType,
      status: metaRegimes.status,
      activatedAt: metaRegimes.activatedAt,
      peakAt: metaRegimes.peakAt,
    })
    .from(metaRegimes)
    .where(eq(metaRegimes.id, regimeId));

  if (regime == null) return null;

  const chains = await db
    .select({
      id: narrativeChains.id,
      bottleneck: narrativeChains.bottleneck,
      supplyChain: narrativeChains.supplyChain,
      sequenceOrder: narrativeChains.sequenceOrder,
      sequenceConfidence: narrativeChains.sequenceConfidence,
      status: narrativeChains.status,
      activatedAt: narrativeChains.activatedAt,
      peakAt: narrativeChains.peakAt,
    })
    .from(narrativeChains)
    .where(eq(narrativeChains.metaRegimeId, regimeId))
    .orderBy(asc(narrativeChains.sequenceOrder));

  return {
    ...regime,
    chains,
  };
}

// ─── Status Transition ──────────────────────────────────────────────

/**
 * Determine what regime status should be based on its chains' statuses.
 * Returns null if no transition needed (status unchanged or no chains).
 *
 * Rules (deterministic — no LLM):
 *  - ACTIVE: at least one chain is ACTIVE
 *  - PEAKED: no chain is ACTIVE (all RESOLVING/RESOLVED/OVERSUPPLY/INVALIDATED)
 *  - RESOLVED: all chains are RESOLVED or INVALIDATED
 */
export function determineRegimeStatus(
  currentStatus: MetaRegimeStatus,
  chainStatuses: NarrativeChainStatus[],
): MetaRegimeStatus | null {
  if (chainStatuses.length === 0) return null;

  const allTerminal = chainStatuses.every(
    (s) => s === "RESOLVED" || s === "INVALIDATED",
  );
  if (allTerminal) {
    return currentStatus === "RESOLVED" ? null : "RESOLVED";
  }

  const noneActive = chainStatuses.every((s) => s !== "ACTIVE");
  if (noneActive) {
    return currentStatus === "PEAKED" ? null : "PEAKED";
  }

  // At least one chain is ACTIVE — regime should be ACTIVE.
  // This handles PEAKED→ACTIVE recovery when a new active chain is linked.
  return currentStatus === "ACTIVE" ? null : "ACTIVE";
}

/**
 * Check all ACTIVE/PEAKED regimes and apply status transitions.
 * Batch-fetches all chains in one query to avoid N+1.
 * Returns count of regimes transitioned.
 */
export async function transitionMetaRegimeStatuses(): Promise<number> {
  const activeRegimes = await getActiveMetaRegimes();
  if (activeRegimes.length === 0) return 0;

  // Batch fetch chains for all active regimes in a single query
  const regimeIds = activeRegimes.map((r) => r.id);
  const allChains = await db
    .select({
      metaRegimeId: narrativeChains.metaRegimeId,
      status: narrativeChains.status,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.metaRegimeId, regimeIds));

  // Group chain statuses by regime ID
  const chainsByRegime = new Map<number, NarrativeChainStatus[]>();
  for (const chain of allChains) {
    if (chain.metaRegimeId == null) continue;
    const existing = chainsByRegime.get(chain.metaRegimeId) ?? [];
    existing.push(chain.status as NarrativeChainStatus);
    chainsByRegime.set(chain.metaRegimeId, existing);
  }

  let transitioned = 0;

  for (const regime of activeRegimes) {
    const chainStatuses = chainsByRegime.get(regime.id) ?? [];
    const newStatus = determineRegimeStatus(regime.status, chainStatuses);

    if (newStatus == null) continue;

    const now = new Date();
    const updateFields: Partial<typeof metaRegimes.$inferInsert> = { status: newStatus };

    if (newStatus === "PEAKED" && regime.peakAt == null) {
      updateFields.peakAt = now;
    }
    if (newStatus === "RESOLVED") {
      updateFields.resolvedAt = now;
      if (regime.peakAt == null) {
        updateFields.peakAt = now;
      }
    }

    await db
      .update(metaRegimes)
      .set(updateFields)
      .where(eq(metaRegimes.id, regime.id));

    transitioned++;
    logger.info(
      "MetaRegime",
      `Regime #${regime.id} "${regime.name}": ${regime.status} → ${newStatus}`,
    );
  }

  return transitioned;
}

// ─── Chain ↔ Regime Linking ─────────────────────────────────────────

/** Stop words for megatrend keyword extraction. */
const STOP_WORDS = new Set([
  "의", "에", "에서", "로", "으로", "가", "이", "을", "를", "는", "은", "과", "와", "및",
  "중", "후", "내", "기준", "현재", "상태", "상승", "하락", "유지", "전환", "진입",
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "is", "are",
]);

/** Extract significant keywords from megatrend text. */
function extractMegatrendKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zA-Z가-힣0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
  );
}

const MIN_MEGATREND_OVERLAP = 2;

/** Active chain statuses used for linking and regime creation. */
const ACTIVE_CHAIN_STATUSES: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];

/**
 * Link a specific chain to a regime with auto-assigned sequence_order.
 */
export async function linkChainToRegime(
  chainId: number,
  regimeId: number,
  confidence: "low" | "medium" | "high" = "medium",
): Promise<void> {
  // Get max existing sequence_order for the regime
  const [maxResult] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(${narrativeChains.sequenceOrder}), 0)` })
    .from(narrativeChains)
    .where(eq(narrativeChains.metaRegimeId, regimeId));

  const nextOrder = (maxResult?.maxOrder ?? 0) + 1;

  await db
    .update(narrativeChains)
    .set({
      metaRegimeId: regimeId,
      sequenceOrder: nextOrder,
      sequenceConfidence: confidence,
    })
    .where(eq(narrativeChains.id, chainId));

  logger.info(
    "MetaRegime",
    `Linked chain #${chainId} → regime #${regimeId} (order: ${nextOrder})`,
  );
}

/**
 * Find unlinked active chains and link them to matching active regimes.
 * Matching is based on megatrend keyword overlap.
 * Returns count of chains linked.
 */
export async function linkUnlinkedChainsToRegimes(): Promise<number> {
  const unlinkedChains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
    })
    .from(narrativeChains)
    .where(
      and(
        isNull(narrativeChains.metaRegimeId),
        inArray(narrativeChains.status, ACTIVE_CHAIN_STATUSES),
      ),
    );

  if (unlinkedChains.length === 0) return 0;

  // Get active regimes with their chains' megatrends (batch fetch)
  const activeRegimes = await getActiveMetaRegimes();
  if (activeRegimes.length === 0) return 0;

  const regimeIds = activeRegimes.map((r) => r.id);
  const allRegimeChains = await db
    .select({
      metaRegimeId: narrativeChains.metaRegimeId,
      megatrend: narrativeChains.megatrend,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.metaRegimeId, regimeIds));

  // Pre-compute keyword sets per regime to avoid redundant extraction inside the loop
  const regimeChainData = activeRegimes.map((regime) => {
    const megatrends = allRegimeChains
      .filter((c) => c.metaRegimeId === regime.id)
      .map((c) => c.megatrend);
    const keywords = new Set<string>();
    for (const mt of megatrends) {
      for (const kw of extractMegatrendKeywords(mt)) {
        keywords.add(kw);
      }
    }
    return { regimeId: regime.id, keywords };
  });

  let linked = 0;

  for (const chain of unlinkedChains) {
    const chainKeywords = extractMegatrendKeywords(chain.megatrend);

    let bestMatch: { regimeId: number; overlap: number } | null = null;

    for (const { regimeId, keywords: regimeKeywords } of regimeChainData) {
      let overlap = 0;
      for (const kw of chainKeywords) {
        if (regimeKeywords.has(kw)) overlap++;
      }

      if (
        overlap >= MIN_MEGATREND_OVERLAP &&
        (bestMatch == null || overlap > bestMatch.overlap)
      ) {
        bestMatch = { regimeId, overlap };
      }
    }

    if (bestMatch != null) {
      await linkChainToRegime(chain.id, bestMatch.regimeId);
      linked++;
    }
  }

  return linked;
}

// ─── Auto Regime Creation ───────────────────────────────────────────

/**
 * Detect groups of 2+ unlinked chains with similar megatrend and create regimes.
 * A chain can only belong to one regime — already-linked chains are excluded.
 * Returns count of regimes created.
 */
export async function detectAndCreateNewRegimes(): Promise<number> {
  const unlinkedChains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      supplyChain: narrativeChains.supplyChain,
    })
    .from(narrativeChains)
    .where(
      and(
        isNull(narrativeChains.metaRegimeId),
        inArray(narrativeChains.status, ACTIVE_CHAIN_STATUSES),
      ),
    );

  if (unlinkedChains.length < 2) return 0;

  // Greedy first-match grouping by megatrend keyword overlap.
  // Note: result is order-dependent — a chain matching multiple groups joins the first one.
  // Acceptable for current scale (typically < 10 unlinked chains per debate run).
  const groups: Array<{ chains: typeof unlinkedChains; keywords: Set<string> }> = [];

  for (const chain of unlinkedChains) {
    const chainKeywords = extractMegatrendKeywords(chain.megatrend);

    let matched = false;
    for (const group of groups) {
      let overlap = 0;
      for (const kw of chainKeywords) {
        if (group.keywords.has(kw)) overlap++;
      }

      if (overlap >= MIN_MEGATREND_OVERLAP) {
        group.chains.push(chain);
        // Merge keywords
        for (const kw of chainKeywords) {
          group.keywords.add(kw);
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups.push({ chains: [chain], keywords: chainKeywords });
    }
  }

  let created = 0;

  for (const group of groups) {
    if (group.chains.length < 2) continue;

    const firstChain = group.chains[0];
    const hasSupplyChainArrow = group.chains.some((c) => c.supplyChain.includes("→"));
    const propagationType: MetaRegimePropagationType = hasSupplyChainArrow
      ? "supply_chain"
      : "narrative_shift";

    const { id: regimeId } = await createMetaRegime({
      name: firstChain.megatrend,
      propagationType,
    });

    for (let i = 0; i < group.chains.length; i++) {
      await linkChainToRegime(group.chains[i].id, regimeId, "medium");
    }

    created++;
    logger.info(
      "MetaRegime",
      `Auto-created regime #${regimeId} "${firstChain.megatrend}" with ${group.chains.length} chains`,
    );
  }

  return created;
}

// ─── Orchestrator ───────────────────────────────────────────────────

/**
 * Main entry point for post-debate meta-regime management.
 * Called after thesis saving in run-debate-agent.ts.
 *
 * Execution order (deliberate two-pass design):
 *  1. Transition existing regime statuses (deterministic rules)
 *  2. Link unlinked chains to matching regimes (keyword matching)
 *  3. Detect and create new regimes from unlinked chain groups
 *
 * Step 3 may create new regimes; step 2 only links to pre-existing regimes.
 * Chains linked to newly created regimes in step 3 will be visible to step 2
 * on the next debate run. This avoids circular dependency within a single run.
 */
export async function manageMetaRegimes(): Promise<{
  transitioned: number;
  linked: number;
  created: number;
}> {
  const transitioned = await transitionMetaRegimeStatuses();
  const linked = await linkUnlinkedChainsToRegimes();
  const created = await detectAndCreateNewRegimes();

  if (transitioned > 0 || linked > 0 || created > 0) {
    logger.info(
      "MetaRegime",
      `Management complete: ${transitioned} transitioned, ${linked} linked, ${created} created`,
    );
  }

  return { transitioned, linked, created };
}

// ─── Prompt Formatting ──────────────────────────────────────────────

const PROPAGATION_LABEL: Record<MetaRegimePropagationType, string> = {
  supply_chain: "병목 전파 (Bullwhip)",
  narrative_shift: "내러티브 전환",
};

/**
 * Format active meta-regimes with their chains for agent prompt injection.
 * Returns empty string if no active regimes exist.
 */
export async function formatMetaRegimesForPrompt(): Promise<string> {
  const regimes = await getActiveMetaRegimes();
  if (regimes.length === 0) return "";

  const regimeIds = regimes.map((r) => r.id);
  const allChains = await db
    .select({
      metaRegimeId: narrativeChains.metaRegimeId,
      bottleneck: narrativeChains.bottleneck,
      supplyChain: narrativeChains.supplyChain,
      sequenceOrder: narrativeChains.sequenceOrder,
      sequenceConfidence: narrativeChains.sequenceConfidence,
      status: narrativeChains.status,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.metaRegimeId, regimeIds))
    .orderBy(asc(narrativeChains.sequenceOrder));

  const sections: string[] = [
    "## 현재 활성 국면 (Meta-Regime)\n",
    "국면은 여러 내러티브 체인이 순차적으로 활성화되는 상위 테마 사이클입니다.",
    "현재 자금이 어디에 있고, 다음에 어디로 갈지 판단할 때 아래 순서를 참조하세요.\n",
  ];

  for (const regime of regimes) {
    const propagation = PROPAGATION_LABEL[regime.propagationType];
    const statusTag = regime.status === "PEAKED" ? " (피크 통과)" : "";

    sections.push(`### ${regime.name}${statusTag}`);
    sections.push(`- 전파 유형: ${propagation}`);

    if (regime.description != null) {
      sections.push(`- 설명: ${regime.description}`);
    }

    const chains = allChains.filter((c) => c.metaRegimeId === regime.id);

    if (chains.length > 0) {
      sections.push("");
      sections.push("| 순서 | 체인 (병목) | 공급망 경로 | 상태 | 신뢰도 |");
      sections.push("|------|-----------|-----------|------|--------|");

      for (const chain of chains) {
        const order = chain.sequenceOrder ?? "—";
        const supply = chain.supplyChain !== "" ? sanitizeCell(chain.supplyChain) : "—";
        const confidence = chain.sequenceConfidence ?? "—";
        sections.push(
          `| ${order} | ${sanitizeCell(chain.bottleneck)} | ${supply} | ${chain.status} | ${confidence} |`,
        );
      }
    }

    sections.push("");
  }

  return sections.join("\n");
}
