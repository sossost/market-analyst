import { db } from "../db/client.js";
import { narrativeChains, type NarrativeChainStatus } from "../db/schema/analyst.js";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { sanitizeCell } from "./markdown.js";

/**
 * ACTIVE/RESOLVING chain의 핵심 식별 정보를 반환.
 * Round 3 프롬프트 서사 다양성 가드레일 생성에 사용.
 */
export async function getActiveChainLabels(): Promise<Array<{
  id: number;
  megatrend: string;
  bottleneck: string;
}>> {
  const activeStatuses: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
  const chains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.status, activeStatuses));

  return chains.map((chain) => ({
    id: chain.id,
    megatrend: chain.megatrend,
    bottleneck: chain.bottleneck,
  }));
}

/**
 * Round 3 프롬프트에 주입할 서사 다양성 가드레일 텍스트 생성.
 * ACTIVE/RESOLVING chain 목록을 테이블로 포맷하여 중복 서사 생성을 억제한다.
 * chain이 없으면 빈 문자열 반환.
 */
export async function formatActiveChainsForDiversityGuard(): Promise<string> {
  const chains = await getActiveChainLabels();
  if (chains.length === 0) return "";

  const rows = chains.map(
    (chain) =>
      `| #${chain.id} | ${sanitizeCell(chain.megatrend)} | ${sanitizeCell(chain.bottleneck)} |`,
  );

  return [
    "## 현재 추적 중인 서사 (중복 생성 금지)\n",
    "아래 서사는 이미 narrative_chains에 등록되어 있습니다.",
    "동일 병목 구조의 새 structural_narrative thesis 생성을 억제하고, 아직 추적되지 않은 병목 서사를 우선 탐색하세요.\n",
    "| 체인 | 메가트렌드 | 현재 병목 |",
    "|------|----------|---------|",
    ...rows,
  ].join("\n");
}

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
  supplyChain: string;
  identifiedAt: Date;
  daysSinceIdentified: number;
  status: NarrativeChainStatus;
  nextBottleneck: string | null;
  linkedThesisCount: number;
  beneficiarySectors: string[];
  beneficiaryTickers: string[];
  nextBeneficiarySectors: string[];
  nextBeneficiaryTickers: string[];
  alphaCompatible: boolean | null;
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
      supplyChain: narrativeChains.supplyChain,
      bottleneckIdentifiedAt: narrativeChains.bottleneckIdentifiedAt,
      status: narrativeChains.status,
      nextBottleneck: narrativeChains.nextBottleneck,
      linkedThesisIds: narrativeChains.linkedThesisIds,
      beneficiarySectors: narrativeChains.beneficiarySectors,
      beneficiaryTickers: narrativeChains.beneficiaryTickers,
      nextBeneficiarySectors: narrativeChains.nextBeneficiarySectors,
      nextBeneficiaryTickers: narrativeChains.nextBeneficiaryTickers,
      alphaCompatible: narrativeChains.alphaCompatible,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.status, activeStatuses));

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;

  return chains.map((chain) => ({
    id: chain.id,
    megatrend: chain.megatrend,
    bottleneck: chain.bottleneck,
    supplyChain: chain.supplyChain,
    identifiedAt: chain.bottleneckIdentifiedAt,
    daysSinceIdentified: Math.round(
      (now.getTime() - chain.bottleneckIdentifiedAt.getTime()) / msPerDay,
    ),
    status: chain.status as NarrativeChainStatus,
    nextBottleneck: chain.nextBottleneck,
    linkedThesisCount: Array.isArray(chain.linkedThesisIds)
      ? chain.linkedThesisIds.length
      : 0,
    beneficiarySectors: Array.isArray(chain.beneficiarySectors)
      ? (chain.beneficiarySectors as string[])
      : [],
    beneficiaryTickers: Array.isArray(chain.beneficiaryTickers)
      ? (chain.beneficiaryTickers as string[])
      : [],
    nextBeneficiarySectors: Array.isArray(chain.nextBeneficiarySectors)
      ? (chain.nextBeneficiarySectors as string[])
      : [],
    nextBeneficiaryTickers: Array.isArray(chain.nextBeneficiaryTickers)
      ? (chain.nextBeneficiaryTickers as string[])
      : [],
    alphaCompatible: chain.alphaCompatible,
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
    "| 체인명 | 메가트렌드 | 공급망 경로 | 상태 | Alpha Gate | 경과일 | 수혜 섹터 | 수혜 종목 |",
    "|--------|----------|-----------|------|-----------|--------|----------|----------|",
  ];

  for (const chain of chains) {
    const alphaTag = formatAlphaTag(chain.alphaCompatible);
    const supply = chain.supplyChain !== "" ? sanitizeCell(chain.supplyChain) : "—";
    const sectors = chain.beneficiarySectors.length > 0
      ? chain.beneficiarySectors.join(", ")
      : "—";
    const tickers = chain.beneficiaryTickers.length > 0
      ? chain.beneficiaryTickers.join(", ")
      : "—";
    lines.push(
      `| ${sanitizeCell(chain.bottleneck)} | ${sanitizeCell(chain.megatrend)} | ${supply} | ${chain.status} | ${alphaTag} | ${chain.daysSinceIdentified}일 | ${sectors} | ${tickers} |`,
    );
  }

  lines.push(
    "",
    "리포트 작성 시 위 체인과 관련된 섹터/종목에 [체인명 / 상태] 태그를 추가하세요.",
    "수혜 종목이 당일 특이종목(get_unusual_stocks)에 포함되면 반드시 서사 체인과 연결하여 분석하세요.",
    "Alpha Gate \"구조적 관찰\" 체인의 수혜 종목은 종목 추천에서 제외하되, 거시 분석 참고용으로 언급할 수 있습니다.",
    "",
    "### 서사 다양성 가드레일",
    "위 체인과 동일한 병목 구조의 structural_narrative thesis는 새로 생성하지 마세요.",
    "아직 추적되지 않은 병목(예: 전력 인프라, 반도체 소재, 방산 부품 등)을 우선 탐색하세요.",
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
    "| 병목 노드 | 메가트렌드 | 공급망 경로 | 식별일 | 경과일 | 상태 | Alpha Gate | N+1 병목 | 수혜 섹터 | 수혜 종목 | N+1 수혜 섹터 | N+1 수혜 종목 | 참고 해소 기간 |",
    "|----------|----------|-----------|--------|-------|------|-----------|---------|----------|----------|------------|------------|-------------|",
  ];

  for (const chain of chains) {
    const dateStr = chain.identifiedAt.toISOString().slice(0, 10);
    const supply = chain.supplyChain !== "" ? sanitizeCell(chain.supplyChain) : "—";
    const nextBn = chain.nextBottleneck != null ? sanitizeCell(chain.nextBottleneck) : "—";
    const sectors = chain.beneficiarySectors.length > 0
      ? chain.beneficiarySectors.join(", ")
      : "—";
    const tickers = chain.beneficiaryTickers.length > 0
      ? chain.beneficiaryTickers.join(", ")
      : "—";
    const nextSectors = chain.nextBeneficiarySectors.length > 0
      ? chain.nextBeneficiarySectors.join(", ")
      : "—";
    const nextTickers = chain.nextBeneficiaryTickers.length > 0
      ? chain.nextBeneficiaryTickers.join(", ")
      : "—";
    const alphaTag = formatAlphaTag(chain.alphaCompatible);
    lines.push(
      `| ${sanitizeCell(chain.bottleneck)} | ${sanitizeCell(chain.megatrend)} | ${supply} | ${dateStr} | ${chain.daysSinceIdentified}일 | ${chain.status} | ${alphaTag} | ${nextBn} | ${sectors} | ${tickers} | ${nextSectors} | ${nextTickers} | ${refResolution} |`,
    );
  }

  lines.push(
    "",
    "※ 해소된 체인이 3개 이상 쌓이면 \"참고 해소 기간\"에 평균 기간이 표시됩니다.",
    "※ 수혜 종목은 현재 병목의 구조적 수혜 종목입니다. 현재 Phase/RS 기준 미달이어도 서사적 워치리스트로 활용하세요.",
    "※ N+1 수혜 섹터/종목은 다음 병목 해소 시 수혜가 예상되는 선행 포착 후보입니다.",
    "※ Alpha Gate \"구조적 관찰\": 해당 섹터의 SEPA 적합성이 낮아 종목 발굴 대상으로 부적합할 수 있음. 거시 분석으로만 활용.",
  );

  return lines.join("\n");
}

/**
 * Alpha Gate 상태를 한글 태그로 변환.
 */
function formatAlphaTag(alphaCompatible: boolean | null): string {
  if (alphaCompatible == null) return "미평가";
  return alphaCompatible ? "통과" : "구조적 관찰";
}

function calculateMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}
