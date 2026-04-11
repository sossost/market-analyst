import { db } from "@/db/client";
import {
  metaRegimes,
  narrativeChains,
  type MetaRegimePropagationType,
  type MetaRegimeStatus,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { eq, inArray, asc } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sanitizeCell } from "@/lib/markdown";

// ─── Keyword Utilities ───────────────────────────────────────────────

/** Stop words filtered out during keyword extraction. */
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
export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zA-Z가-힣0-9\s]/g, " ")
      .split(/\s+/)
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
 * Link a narrative chain to a meta-regime with a sequence order.
 * narrative_chains 테이블의 metaRegimeId, sequenceOrder 컬럼을 업데이트한다.
 */
export async function linkChainToMetaRegime(
  chainId: number,
  regimeId: number,
  sequenceOrder: number,
): Promise<void> {
  try {
    await db
      .update(narrativeChains)
      .set({ metaRegimeId: regimeId, sequenceOrder })
      .where(eq(narrativeChains.id, chainId));

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
      .from(narrativeChains)
      .where(eq(narrativeChains.metaRegimeId, regimeId));

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
 * 특정 국면에 연결된 체인 수를 조회한다.
 * linkChainToMetaRegime 호출 시 sequenceOrder 계산에 사용된다.
 */
export async function getChainCountInMetaRegime(regimeId: number): Promise<number> {
  const chains = await db
    .select({ id: narrativeChains.id })
    .from(narrativeChains)
    .where(eq(narrativeChains.metaRegimeId, regimeId));
  return chains.length;
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
  const MIN_OVERLAP = 2;
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
