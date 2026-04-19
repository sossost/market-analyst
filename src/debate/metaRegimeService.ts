import { db } from "@/db/client";
import {
  metaRegimes,
  narrativeChains,
  narrativeChainRegimes,
  type MetaRegimePropagationType,
  type MetaRegimeStatus,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { eq, inArray, asc, isNull, and, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sanitizeCell } from "@/lib/markdown";
import {
  replaceMultiWordSynonyms,
  normalizeSingleWord,
} from "@/debate/synonymDictionary";

// ─── Keyword Utilities ───────────────────────────────────────────────

/** Stop words filtered out during keyword extraction. */
const STOP_WORDS = new Set([
  // Korean particles & postpositions
  "의", "에", "에서", "로", "으로", "가", "이", "을", "를", "는", "은", "과", "와", "및",
  "중", "후", "내", "기준", "현재", "상태", "상승", "하락", "유지", "전환", "진입",
  // Generic Korean analysis words — too common to distinguish narratives (#793)
  "지속", "가능성", "영향", "발생", "관련", "대한", "통해", "따른", "위한", "대비",
  "수준", "예상", "변화", "확대", "축소", "증가", "감소",
  // English articles & prepositions
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "is", "are", "was", "were",
  // Status keywords (to avoid matching on status text itself)
  "active", "resolving", "resolved",
]);

/**
 * Extract significant keywords from text for matching.
 * Filters out common stop words and short tokens.
 *
 * Normalization pipeline:
 * 1. Lowercase + strip non-alphanum
 * 2. Replace multi-word synonym phrases with canonical form
 * 3. Tokenize on whitespace
 * 4. Normalize single-word synonyms to canonical form
 * 5. Filter stop words and short tokens
 */
export function extractKeywords(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(/[^a-zA-Z가-힣0-9\s]/g, " ");
  const phraseNormalized = replaceMultiWordSynonyms(cleaned);
  return new Set(
    phraseNormalized
      .split(/\s+/)
      .map(normalizeSingleWord)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
  );
}

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
      sequenceOrder: narrativeChainRegimes.sequenceOrder,
      sequenceConfidence: narrativeChainRegimes.sequenceConfidence,
      status: narrativeChains.status,
      activatedAt: narrativeChains.activatedAt,
      peakAt: narrativeChains.peakAt,
    })
    .from(narrativeChainRegimes)
    .innerJoin(narrativeChains, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(eq(narrativeChainRegimes.regimeId, regimeId))
    .orderBy(asc(narrativeChainRegimes.sequenceOrder));

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

  // junction table 기준으로 배치 조회 — N+1 방지
  const regimeIds = activeRegimes.map((r) => r.id);
  const allChains = await db
    .select({
      regimeId: narrativeChainRegimes.regimeId,
      status: narrativeChains.status,
    })
    .from(narrativeChainRegimes)
    .innerJoin(narrativeChains, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(inArray(narrativeChainRegimes.regimeId, regimeIds));

  // Group chain statuses by regime ID
  const chainsByRegime = new Map<number, NarrativeChainStatus[]>();
  for (const chain of allChains) {
    const existing = chainsByRegime.get(chain.regimeId) ?? [];
    existing.push(chain.status as NarrativeChainStatus);
    chainsByRegime.set(chain.regimeId, existing);
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
/** Extract significant keywords from megatrend text with synonym normalization. */
function extractMegatrendKeywords(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(/[^a-zA-Z가-힣0-9\s]/g, " ");
  const phraseNormalized = replaceMultiWordSynonyms(cleaned);
  return new Set(
    phraseNormalized
      .split(/\s+/)
      .map(normalizeSingleWord)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
  );
}

const MIN_MEGATREND_OVERLAP = 3;

/** Active chain statuses used for linking and regime creation. */
const ACTIVE_CHAIN_STATUSES: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];

/**
 * junction table에 체인-국면 링크를 삽입한다.
 * sequence_order는 해당 국면의 기존 최대값 + 1로 자동 부여.
 * 이미 존재하는 링크는 무시한다 (ON CONFLICT DO NOTHING).
 */
export async function linkChainToRegime(
  chainId: number,
  regimeId: number,
  confidence: "low" | "medium" | "high" = "medium",
): Promise<void> {
  const [maxResult] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(${narrativeChainRegimes.sequenceOrder}), 0)` })
    .from(narrativeChainRegimes)
    .where(eq(narrativeChainRegimes.regimeId, regimeId));

  const nextOrder = (maxResult?.maxOrder ?? 0) + 1;

  await db
    .insert(narrativeChainRegimes)
    .values({
      chainId,
      regimeId,
      sequenceOrder: nextOrder,
      sequenceConfidence: confidence,
    })
    .onConflictDoNothing();

  logger.info(
    "MetaRegime",
    `Linked chain #${chainId} → regime #${regimeId} (order: ${nextOrder})`,
  );
}

/**
 * junction table에 미등록된 활성 체인을 찾아 기존 활성 국면에 링크한다.
 * 매칭은 megatrend 키워드 overlap 기반으로 수행한다.
 * 반환: 링크된 체인 수.
 */
export async function linkUnlinkedChainsToRegimes(): Promise<number> {
  // LEFT JOIN으로 단일 쿼리에서 미연결 활성 체인만 필터링
  const unlinkedChains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
    })
    .from(narrativeChains)
    .leftJoin(narrativeChainRegimes, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(
      and(
        isNull(narrativeChainRegimes.chainId),
        inArray(narrativeChains.status, ACTIVE_CHAIN_STATUSES),
      ),
    );

  if (unlinkedChains.length === 0) return 0;

  const activeRegimes = await getActiveMetaRegimes();
  if (activeRegimes.length === 0) return 0;

  const regimeIds = activeRegimes.map((r) => r.id);

  // junction table 기준으로 각 국면에 연결된 체인의 megatrend를 배치 조회
  const allRegimeChains = await db
    .select({
      regimeId: narrativeChainRegimes.regimeId,
      megatrend: narrativeChains.megatrend,
    })
    .from(narrativeChainRegimes)
    .innerJoin(narrativeChains, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(inArray(narrativeChainRegimes.regimeId, regimeIds));

  // 국면별 키워드 집합 사전 계산 — 루프 내 중복 추출 방지
  const regimeChainData = activeRegimes.map((regime) => {
    const megatrends = allRegimeChains
      .filter((c) => c.regimeId === regime.id)
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
 * junction table에 미등록된 활성 체인 2개 이상이 megatrend를 공유하는 경우
 * 새 국면을 자동 생성하고 해당 체인들을 연결한다.
 * 반환: 생성된 국면 수.
 */
export async function detectAndCreateNewRegimes(): Promise<number> {
  // LEFT JOIN으로 단일 쿼리에서 미연결 활성 체인만 필터링
  const unlinkedChains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      supplyChain: narrativeChains.supplyChain,
    })
    .from(narrativeChains)
    .leftJoin(narrativeChainRegimes, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(
      and(
        isNull(narrativeChainRegimes.chainId),
        inArray(narrativeChains.status, ACTIVE_CHAIN_STATUSES),
      ),
    );

  if (unlinkedChains.length < 2) return 0;

  type UnlinkedChain = { id: number; megatrend: string; supplyChain: string };

  // Greedy first-match grouping by megatrend keyword overlap.
  // Note: result is order-dependent — a chain matching multiple groups joins the first one.
  // Acceptable for current scale (typically < 10 unlinked chains per debate run).
  const groups: Array<{ chains: UnlinkedChain[]; keywords: Set<string> }> = [];

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

    let regimeId: number;

    await db.transaction(async (tx) => {
      // regime 생성
      const [regimeResult] = await tx
        .insert(metaRegimes)
        .values({
          name: firstChain.megatrend,
          propagationType,
          activatedAt: new Date(),
        })
        .returning({ id: metaRegimes.id });

      if (regimeResult == null) {
        throw new Error(`Failed to insert meta-regime: no row returned for "${firstChain.megatrend}"`);
      }

      regimeId = regimeResult.id;

      // 각 체인 링크 삽입 — 중간 실패 시 regime + 링크 모두 롤백
      for (let i = 0; i < group.chains.length; i++) {
        const [maxResult] = await tx
          .select({ maxOrder: sql<number>`COALESCE(MAX(${narrativeChainRegimes.sequenceOrder}), 0)` })
          .from(narrativeChainRegimes)
          .where(eq(narrativeChainRegimes.regimeId, regimeId));

        const nextOrder = (maxResult?.maxOrder ?? 0) + 1;

        await tx
          .insert(narrativeChainRegimes)
          .values({
            chainId: group.chains[i].id,
            regimeId,
            sequenceOrder: nextOrder,
            sequenceConfidence: "medium",
          })
          .onConflictDoNothing();
      }
    });

    created++;
    logger.info(
      "MetaRegime",
      `Auto-created regime #${regimeId!} "${firstChain.megatrend}" with ${group.chains.length} chains`,
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
      regimeId: narrativeChainRegimes.regimeId,
      bottleneck: narrativeChains.bottleneck,
      supplyChain: narrativeChains.supplyChain,
      sequenceOrder: narrativeChainRegimes.sequenceOrder,
      sequenceConfidence: narrativeChainRegimes.sequenceConfidence,
      status: narrativeChains.status,
    })
    .from(narrativeChainRegimes)
    .innerJoin(narrativeChains, eq(narrativeChainRegimes.chainId, narrativeChains.id))
    .where(inArray(narrativeChainRegimes.regimeId, regimeIds))
    .orderBy(asc(narrativeChainRegimes.sequenceOrder));

  const sections: string[] = [
    // 이 헤더 문자열을 변경하면 run-debate-agent.ts의 NARRATIVE_CHAIN_ACTIVE_REGIME_MARKER도 함께 수정해야 한다.
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

    const chains = allChains.filter((c) => c.regimeId === regime.id);

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

// ─── Write Functions ─────────────────────────────────────────────────

/**
 * Transition meta-regime status.
 * PEAKED 전이 시 peakAt 타임스탬프를 자동 세팅한다.
 */
export async function transitionMetaRegimeStatus(
  regimeId: number,
  newStatus: MetaRegimeStatus,
): Promise<void> {
  try {
    const isPeaked = newStatus === "PEAKED";
    const isResolved = newStatus === "RESOLVED";

    await db
      .update(metaRegimes)
      .set({
        status: newStatus,
        ...(isPeaked && { peakAt: new Date() }),
        ...(isResolved && { resolvedAt: new Date() }),
      })
      .where(eq(metaRegimes.id, regimeId));

    logger.info(
      "MetaRegime",
      `Transitioned meta-regime #${regimeId} → ${newStatus}`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      "MetaRegime",
      `transitionMetaRegimeStatus failed for #${regimeId}: ${reason}`,
    );
    throw err;
  }
}

/**
 * Update the description of a meta-regime.
 */
export async function updateMetaRegimeDescription(
  regimeId: number,
  description: string,
): Promise<void> {
  try {
    await db
      .update(metaRegimes)
      .set({ description })
      .where(eq(metaRegimes.id, regimeId));

    logger.info(
      "MetaRegime",
      `Updated description for meta-regime #${regimeId}`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      "MetaRegime",
      `updateMetaRegimeDescription failed for #${regimeId}: ${reason}`,
    );
    throw err;
  }
}

/**
 * junction table에 체인-국면 링크를 삽입한다.
 * 시그니처는 기존과 동일하게 유지하여 run-debate-agent.ts 호환성을 보장한다.
 * 이미 존재하는 링크는 무시한다 (ON CONFLICT DO NOTHING).
 */
export async function linkChainToMetaRegime(
  chainId: number,
  regimeId: number,
  sequenceOrder: number,
): Promise<void> {
  try {
    await db
      .insert(narrativeChainRegimes)
      .values({
        chainId,
        regimeId,
        sequenceOrder,
        sequenceConfidence: "medium",
      })
      .onConflictDoNothing();

    logger.info(
      "MetaRegime",
      `Linked chain #${chainId} to meta-regime #${regimeId} (order: ${sequenceOrder})`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      "MetaRegime",
      `linkChainToMetaRegime failed (chain #${chainId} → regime #${regimeId}): ${reason}`,
    );
    throw err;
  }
}

/**
 * 국면 PEAKED 전이 판정에 사용되는 체인 상태 집합.
 * 체인이 더 이상 ACTIVE가 아닌 상태들.
 * RESOLVING(해소 중) 이상이면 국면의 피크가 지났다고 판정한다.
 */
const CHAIN_PEAKED_OR_BEYOND: Set<NarrativeChainStatus> = new Set([
  "RESOLVING",
  "RESOLVED",
  "OVERSUPPLY",
  "INVALIDATED",
]);

/** 국면 RESOLVED 전이 판정에 사용되는 체인 터미널 상태 집합. */
const CHAIN_TERMINAL_STATUSES: Set<NarrativeChainStatus> = new Set([
  "RESOLVED",
  "OVERSUPPLY",
  "INVALIDATED",
]);

/**
 * 국면에 연결된 체인 상태를 기반으로 국면 상태를 결정론적으로 동기화한다.
 *
 * 전이 규칙:
 * - 체인 0개 → 변화 없음
 * - 현재 RESOLVED → 역전이 금지, 변화 없음
 * - ACTIVE/RESOLVING 체인 >= 1개 → ACTIVE 유지
 * - 모든 체인이 PEAKED/RESOLVED/OVERSUPPLY → PEAKED
 * - 모든 체인이 RESOLVED/OVERSUPPLY → RESOLVED
 */
export async function syncMetaRegimeStatus(regimeId: number): Promise<{
  regimeId: number;
  previousStatus: MetaRegimeStatus;
  newStatus: MetaRegimeStatus;
  changed: boolean;
}> {
  try {
    const [regime] = await db
      .select({ id: metaRegimes.id, status: metaRegimes.status })
      .from(metaRegimes)
      .where(eq(metaRegimes.id, regimeId));

    if (regime == null) {
      throw new Error(`Meta-regime #${regimeId} not found`);
    }

    const previousStatus = regime.status;

    if (previousStatus === "RESOLVED") {
      return { regimeId, previousStatus, newStatus: previousStatus, changed: false };
    }

    const chains = await db
      .select({ status: narrativeChains.status })
      .from(narrativeChainRegimes)
      .innerJoin(narrativeChains, eq(narrativeChainRegimes.chainId, narrativeChains.id))
      .where(eq(narrativeChainRegimes.regimeId, regimeId));

    if (chains.length === 0) {
      return { regimeId, previousStatus, newStatus: previousStatus, changed: false };
    }

    const allPeakedOrBeyond = chains.every((c) =>
      CHAIN_PEAKED_OR_BEYOND.has(c.status as NarrativeChainStatus),
    );
    const allTerminal = chains.every((c) =>
      CHAIN_TERMINAL_STATUSES.has(c.status as NarrativeChainStatus),
    );

    let newStatus: MetaRegimeStatus;
    if (allTerminal) {
      newStatus = "RESOLVED";
    } else if (allPeakedOrBeyond) {
      newStatus = "PEAKED";
    } else {
      newStatus = "ACTIVE";
    }

    if (newStatus === previousStatus) {
      return { regimeId, previousStatus, newStatus, changed: false };
    }

    await transitionMetaRegimeStatus(regimeId, newStatus);

    logger.info(
      "MetaRegime",
      `syncMetaRegimeStatus #${regimeId}: ${previousStatus} → ${newStatus} (chains: ${chains.length})`,
    );

    return { regimeId, previousStatus, newStatus, changed: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      "MetaRegime",
      `syncMetaRegimeStatus failed for #${regimeId}: ${reason}`,
    );
    throw err;
  }
}

const META_REGIME_SIMILARITY_THRESHOLD = 3;

/**
 * 이름과 메가트렌드 키워드를 기반으로 유사한 활성 국면을 찾는다.
 * 활성 국면(ACTIVE/PEAKED)의 name + description 키워드와 입력의 name + megatrends 키워드를 비교.
 * overlap >= 3이면 중복으로 판단하여 반환, 없으면 null.
 */
export async function findSimilarMetaRegime(
  name: string,
  megatrends: string[],
): Promise<{ id: number; name: string } | null> {
  const activeStatuses: MetaRegimeStatus[] = ["ACTIVE", "PEAKED"];
  const candidates = await db
    .select({
      id: metaRegimes.id,
      name: metaRegimes.name,
      description: metaRegimes.description,
    })
    .from(metaRegimes)
    .where(inArray(metaRegimes.status, activeStatuses));

  const inputText = [name, ...megatrends].join(" ");
  const inputKeywords = extractKeywords(inputText);

  let bestMatch: { id: number; name: string; overlap: number } | null = null;

  for (const candidate of candidates) {
    const candidateText = [
      candidate.name,
      candidate.description ?? "",
    ].join(" ");
    const candidateKeywords = extractKeywords(candidateText);

    let overlap = 0;
    for (const kw of inputKeywords) {
      if (candidateKeywords.has(kw)) overlap++;
    }

    if (
      overlap >= META_REGIME_SIMILARITY_THRESHOLD &&
      (bestMatch == null || overlap > bestMatch.overlap)
    ) {
      bestMatch = { id: candidate.id, name: candidate.name, overlap };
    }
  }

  if (bestMatch == null) return null;

  return { id: bestMatch.id, name: bestMatch.name };
}

/**
 * junction table 기준으로 특정 국면에 연결된 체인 수를 조회한다.
 * linkChainToMetaRegime 호출 시 sequenceOrder 계산에 사용된다.
 */
export async function getChainCountInMetaRegime(regimeId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(narrativeChainRegimes)
    .where(eq(narrativeChainRegimes.regimeId, regimeId));
  return row?.count ?? 0;
}

type UnlinkedChain = {
  id: number;
  megatrend: string;
  bottleneck: string;
  status: string;
};

/**
 * megatrend 키워드 기반으로 체인을 그루핑한다.
 * 서로 MIN_KEYWORD_OVERLAP 이상의 키워드를 공유하는 체인을 같은 그룹으로 묶는다.
 * 그룹 키는 공통 키워드들을 공백으로 결합한 문자열.
 */
export function groupChainsByMegatrend(
  chains: UnlinkedChain[],
): Map<string, UnlinkedChain[]> {
  const MIN_OVERLAP = 3;
  const groups: Array<{ keywords: Set<string>; chains: UnlinkedChain[] }> = [];

  for (const chain of chains) {
    const kw = extractKeywords(chain.megatrend);
    let merged = false;

    for (const group of groups) {
      let overlap = 0;
      for (const k of kw) {
        if (group.keywords.has(k)) overlap++;
      }
      if (overlap >= MIN_OVERLAP) {
        group.chains.push(chain);
        // 공통 키워드만 유지 (교집합)
        for (const gk of [...group.keywords]) {
          if (!kw.has(gk)) group.keywords.delete(gk);
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({ keywords: new Set(kw), chains: [chain] });
    }
  }

  const result = new Map<string, UnlinkedChain[]>();
  for (const group of groups) {
    const key = [...group.keywords].sort().join(" ");
    if (key.length > 0) {
      result.set(key, group.chains);
    }
  }
  return result;
}
