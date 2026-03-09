import { db } from "../db/client.js";
import { narrativeChains, type NarrativeChainStatus } from "../db/schema/analyst.js";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";

const MIN_RESOLVED_FOR_STATS = 3;

export interface ChainStats {
  totalChains: number;
  resolvedChains: number;
  avgResolutionDays: number | null;
  medianResolutionDays: number | null;
  chainsByMegatrend: Record<string, number>;
}

export interface ActiveChainSummary {
  id: number;
  megatrend: string;
  bottleneck: string;
  identifiedAt: Date;
  daysSinceIdentified: number;
  status: NarrativeChainStatus;
  nextBottleneck: string | null;
  linkedThesisCount: number;
}

/**
 * Get overall chain statistics.
 * Returns null for average/median if fewer than MIN_RESOLVED_FOR_STATS resolved chains.
 */
export async function getChainStats(): Promise<ChainStats> {
  const allChains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      status: narrativeChains.status,
      resolutionDays: narrativeChains.resolutionDays,
    })
    .from(narrativeChains);

  const resolvedStatuses: NarrativeChainStatus[] = ["RESOLVED", "OVERSUPPLY"];
  const resolvedDays = allChains
    .filter(
      (c) =>
        resolvedStatuses.includes(c.status as NarrativeChainStatus) &&
        c.resolutionDays != null,
    )
    .map((c) => c.resolutionDays as number);

  const chainsByMegatrend: Record<string, number> = {};
  for (const chain of allChains) {
    chainsByMegatrend[chain.megatrend] = (chainsByMegatrend[chain.megatrend] ?? 0) + 1;
  }

  let avgResolutionDays: number | null = null;
  let medianResolutionDays: number | null = null;

  if (resolvedDays.length >= MIN_RESOLVED_FOR_STATS) {
    const sorted = [...resolvedDays].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, d) => acc + d, 0);
    avgResolutionDays = Math.round(sum / sorted.length);
    medianResolutionDays = calculateMedian(sorted);
  }

  return {
    totalChains: allChains.length,
    resolvedChains: resolvedDays.length,
    avgResolutionDays,
    medianResolutionDays,
    chainsByMegatrend,
  };
}

/**
 * Get summary of active (ACTIVE + RESOLVING) chains for prompt injection.
 */
export async function getActiveChainsSummary(): Promise<ActiveChainSummary[]> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  const chains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
      bottleneckIdentifiedAt: narrativeChains.bottleneckIdentifiedAt,
      status: narrativeChains.status,
      nextBottleneck: narrativeChains.nextBottleneck,
      linkedThesisIds: narrativeChains.linkedThesisIds,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.status, activeStatuses));

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;

  return chains.map((chain) => ({
    id: chain.id,
    megatrend: chain.megatrend,
    bottleneck: chain.bottleneck,
    identifiedAt: chain.bottleneckIdentifiedAt,
    daysSinceIdentified: Math.round(
      (now.getTime() - chain.bottleneckIdentifiedAt.getTime()) / msPerDay,
    ),
    status: chain.status as NarrativeChainStatus,
    nextBottleneck: chain.nextBottleneck,
    linkedThesisCount: Array.isArray(chain.linkedThesisIds)
      ? chain.linkedThesisIds.length
      : 0,
  }));
}

/**
 * Format active chains for daily agent prompt — concise table for tag reference.
 * Returns empty string if no active chains exist.
 */
export async function formatChainsForDailyPrompt(): Promise<string> {
  const chains = await getActiveChainsSummary();
  if (chains.length === 0) return "";

  const lines: string[] = [
    "## 현재 추적 중인 서사 체인 (종목 태그 참조용)\n",
    "| 체인명 | 메가트렌드 | 상태 | 경과일 |",
    "|--------|----------|------|--------|",
  ];

  for (const chain of chains) {
    lines.push(
      `| ${chain.bottleneck} | ${chain.megatrend} | ${chain.status} | ${chain.daysSinceIdentified}일 |`,
    );
  }

  lines.push(
    "",
    "리포트 작성 시 위 체인과 관련된 섹터/종목에 [체인명 / 상태] 태그를 추가하세요.",
  );

  return lines.join("\n");
}

/**
 * Format active chains summary for weekly agent prompt injection.
 * Returns empty string if no active chains exist.
 */
export async function formatChainsSummaryForPrompt(): Promise<string> {
  const chains = await getActiveChainsSummary();
  if (chains.length === 0) return "";

  const stats = await getChainStats();
  const refResolution =
    stats.avgResolutionDays != null
      ? `평균 ${stats.avgResolutionDays}일`
      : "데이터 축적 중";

  const lines: string[] = [
    "## 현재 추적 중인 병목 체인\n",
    "| 병목 노드 | 메가트렌드 | 식별일 | 경과일 | 상태 | 참고 해소 기간 |",
    "|----------|----------|--------|-------|------|-------------|",
  ];

  for (const chain of chains) {
    const dateStr = chain.identifiedAt.toISOString().slice(0, 10);
    lines.push(
      `| ${chain.bottleneck} | ${chain.megatrend} | ${dateStr} | ${chain.daysSinceIdentified}일 | ${chain.status} | ${refResolution} |`,
    );
  }

  lines.push(
    "",
    "※ 해소된 체인이 3개 이상 쌓이면 \"참고 해소 기간\"에 평균 기간이 표시됩니다.",
  );

  return lines.join("\n");
}

function calculateMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}
