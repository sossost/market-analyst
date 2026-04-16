/**
 * readTrackedStocksPerformance — 트래킹 종목 성과 조회 도구.
 *
 * readRecommendationPerformance를 대체한다.
 * source별/tier별 성과 통계, ACTIVE/EXPIRED/EXITED 구분,
 * this_week 기간 필터를 제공한다.
 * 기존 closeReason별 통계(trailingStop/phaseExit/stopLoss)는
 * exit_reason 기반 단순화로 대체한다.
 */

import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateNumber } from "./validation";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 30;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * 이번 주 월요일 날짜를 YYYY-MM-DD 형식으로 반환.
 * 일요일이면 직전 월요일을 반환한다.
 */
function getThisWeekMonday(): string {
  const now = new Date();
  const utcDay = now.getUTCDay(); // 0=일, 1=월, ..., 6=토
  const diff = utcDay === 0 ? 6 : utcDay - 1;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff),
  );
  return monday.toISOString().slice(0, 10);
}

// ─── Row Types ────────────────────────────────────────────────────────────────

interface TrackedStockPerfRow {
  id: number;
  symbol: string;
  source: string;
  tier: string;
  status: string;
  entry_date: string;
  entry_phase: number;
  current_phase: number | null;
  entry_price: string | null;
  current_price: string | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  days_tracked: number;
  exit_date: string | null;
  exit_reason: string | null;
  return_7d: string | null;
  return_30d: string | null;
  return_90d: string | null;
  phase2_since: string | null;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * 트래킹 종목의 성과를 조회하는 도구.
 * source별/tier별 성과 통계, 기간 필터, 상태 필터를 지원한다.
 */
export const readTrackedStocksPerformance: AgentTool = {
  definition: {
    name: "read_tracked_stocks_performance",
    description:
      "트래킹 종목의 성과를 조회합니다. source별(etl_auto/agent/thesis_aligned), tier별(standard/featured) 통계와 ACTIVE/EXPIRED/EXITED 구분을 제공합니다. period='this_week'으로 이번 주 성과를 확인할 수 있습니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["ACTIVE", "EXPIRED", "EXITED", "ALL"],
          description: "조회할 상태 (기본 ALL)",
        },
        limit: {
          type: "number",
          description: "최대 반환 건수 (기본 30)",
        },
        period: {
          type: "string",
          enum: ["all", "this_week"],
          description: "조회 기간. all(기본): 전체, this_week: 이번 주 등록/종료 건만",
        },
        source: {
          type: "string",
          enum: ["etl_auto", "agent", "thesis_aligned"],
          description: "소스 필터 (선택). 지정 시 해당 source만 집계.",
        },
        tier: {
          type: "string",
          enum: ["standard", "featured"],
          description: "티어 필터 (선택). 지정 시 해당 tier만 집계.",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const period = input.period === "this_week" ? "this_week" : "all";

    if (period === "this_week") {
      return executeThisWeek(input);
    }

    return executeAll(input);
  },
};

// ─── 헬퍼: 파라미터 배열에 값을 추가하고 플레이스홀더 인덱스를 반환 ───────────

/**
 * params 배열에 value를 추가한 뒤, 새 플레이스홀더 문자열($N)을 반환한다.
 * off-by-one 오류 없이 동적 WHERE 조건을 안전하게 빌드하기 위해 사용한다.
 */
function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

// ─── 전체 조회 ────────────────────────────────────────────────────────────────

async function executeAll(input: Record<string, unknown>): Promise<string> {
  const statusFilter =
    typeof input.status === "string" ? input.status : "ALL";
  const limit = validateNumber(input.limit, DEFAULT_LIMIT);
  const sourceFilter = typeof input.source === "string" ? input.source : null;
  const tierFilter = typeof input.tier === "string" ? input.tier : null;

  const whereConditions: string[] = [];
  const params: unknown[] = [];

  if (sourceFilter != null) {
    whereConditions.push(`source = ${addParam(params, sourceFilter)}`);
  }

  if (tierFilter != null) {
    whereConditions.push(`tier = ${addParam(params, tierFilter)}`);
  }

  const baseWhere =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  // ACTIVE 조회
  const fetchActive = statusFilter === "ACTIVE" || statusFilter === "ALL";
  const fetchNonActive = statusFilter === "EXPIRED" || statusFilter === "EXITED" || statusFilter === "ALL";

  const activeParams = [...params];
  const activeQuery = fetchActive
    ? retryDatabaseOperation(() =>
        pool.query<TrackedStockPerfRow>(
          `SELECT id, symbol, source, tier, status,
                  entry_date, entry_phase, current_phase,
                  entry_price::text, current_price::text,
                  pnl_percent::text, max_pnl_percent::text,
                  days_tracked, exit_date, exit_reason,
                  return_7d::text, return_30d::text, return_90d::text,
                  phase2_since
           FROM tracked_stocks
           ${baseWhere !== "" ? baseWhere + " AND" : "WHERE"} status = 'ACTIVE'
           ORDER BY entry_date DESC
           LIMIT ${addParam(activeParams, limit)}`,
          activeParams,
        ),
      )
    : Promise.resolve({ rows: [] as TrackedStockPerfRow[] });

  // 비ACTIVE 조회 (EXPIRED + EXITED)
  const nonActiveWhere = buildNonActiveWhere(statusFilter, params, whereConditions);
  const nonActiveParams = [...nonActiveWhere.params];
  const nonActiveQuery = fetchNonActive
    ? retryDatabaseOperation(() =>
        pool.query<TrackedStockPerfRow>(
          `SELECT id, symbol, source, tier, status,
                  entry_date, entry_phase, current_phase,
                  entry_price::text, current_price::text,
                  pnl_percent::text, max_pnl_percent::text,
                  days_tracked, exit_date, exit_reason,
                  return_7d::text, return_30d::text, return_90d::text,
                  phase2_since
           FROM tracked_stocks
           ${nonActiveWhere.clause}
           ORDER BY exit_date DESC NULLS LAST
           LIMIT ${addParam(nonActiveParams, limit)}`,
          nonActiveParams,
        ),
      )
    : Promise.resolve({ rows: [] as TrackedStockPerfRow[] });

  const [activeResult, nonActiveResult] = await Promise.all([
    activeQuery,
    nonActiveQuery,
  ]);

  const activeRecs = activeResult.rows;
  const closedRecs = nonActiveResult.rows;

  const summary = buildSummary(activeRecs, closedRecs);

  // source별 통계
  const allRecs = [...activeRecs, ...closedRecs];
  const bySource = buildBySourceStats(allRecs);
  const byTier = buildByTierStats(allRecs);

  // 포착 선행성 통계
  const detectionLag = buildDetectionLagStats(allRecs);
  const detectionLagBySource = buildDetectionLagBySource(allRecs);

  // exit_reason별 성과 분리
  const exitReasonPerf = buildExitReasonPerfStats(allRecs);

  const active =
    statusFilter === "EXPIRED" || statusFilter === "EXITED"
      ? []
      : activeRecs.map(formatActiveRow);

  const recentClosed =
    statusFilter === "ACTIVE"
      ? []
      : closedRecs.map(formatClosedRow);

  return JSON.stringify({ summary, bySource, byTier, detectionLag, detectionLagBySource, exitReasonPerf, active, recentClosed });
}

// ─── 이번 주 조회 ─────────────────────────────────────────────────────────────

async function executeThisWeek(input: Record<string, unknown>): Promise<string> {
  const weekStart = getThisWeekMonday();
  const sourceFilter = typeof input.source === "string" ? input.source : null;
  const tierFilter = typeof input.tier === "string" ? input.tier : null;

  const filterConditions: string[] = [];
  const filterParams: unknown[] = [weekStart];

  if (sourceFilter != null) {
    filterParams.push(sourceFilter);
    filterConditions.push(`source = $${filterParams.length}`);
  }

  if (tierFilter != null) {
    filterParams.push(tierFilter);
    filterConditions.push(`tier = $${filterParams.length}`);
  }

  const optionalFilter =
    filterConditions.length > 0
      ? `AND ${filterConditions.join(" AND ")}`
      : "";

  const [newThisWeekResult, closedThisWeekResult, phaseExitsResult] =
    await Promise.all([
      retryDatabaseOperation(() =>
        pool.query<TrackedStockPerfRow>(
          `SELECT id, symbol, source, tier, status,
                  entry_date, entry_phase, current_phase,
                  entry_price::text, current_price::text,
                  pnl_percent::text, max_pnl_percent::text,
                  days_tracked, exit_date, exit_reason,
                  return_7d::text, return_30d::text, return_90d::text,
                  phase2_since
           FROM tracked_stocks
           WHERE entry_date >= $1 ${optionalFilter}
           ORDER BY entry_date DESC`,
          filterParams,
        ),
      ),
      retryDatabaseOperation(() =>
        pool.query<TrackedStockPerfRow>(
          `SELECT id, symbol, source, tier, status,
                  entry_date, entry_phase, current_phase,
                  entry_price::text, current_price::text,
                  pnl_percent::text, max_pnl_percent::text,
                  days_tracked, exit_date, exit_reason,
                  return_7d::text, return_30d::text, return_90d::text,
                  phase2_since
           FROM tracked_stocks
           WHERE exit_date >= $1
             AND status <> 'ACTIVE'
             ${optionalFilter}
           ORDER BY exit_date DESC`,
          filterParams,
        ),
      ),
      retryDatabaseOperation(() =>
        pool.query<TrackedStockPerfRow>(
          `SELECT id, symbol, source, tier, status,
                  entry_date, entry_phase, current_phase,
                  entry_price::text, current_price::text,
                  pnl_percent::text, max_pnl_percent::text,
                  days_tracked, exit_date, exit_reason,
                  return_7d::text, return_30d::text, return_90d::text,
                  phase2_since
           FROM tracked_stocks
           WHERE status = 'ACTIVE'
             AND current_phase IS NOT NULL
             AND current_phase != COALESCE(
               (SELECT (elem->>'phase')::int
                FROM jsonb_array_elements(phase_trajectory) AS elem
                WHERE (elem->>'date') < $1
                ORDER BY (elem->>'date') DESC
                LIMIT 1),
               entry_phase
             )
             ${optionalFilter}`,
          filterParams,
        ),
      ),
    ]);

  const newThisWeek = newThisWeekResult.rows;
  const closedThisWeek = closedThisWeekResult.rows;
  const phaseExits = phaseExitsResult.rows;

  const closedWithPnl = closedThisWeek.filter((r) => r.pnl_percent != null);
  const winners = closedWithPnl.filter((r) => toNum(r.pnl_percent) > 0);
  const weekAvgPnl =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((sum, r) => sum + toNum(r.pnl_percent), 0) /
        closedWithPnl.length
      : 0;

  // exit_reason 기반 종료 분류
  const exitReasonGroups = groupByExitReason(closedThisWeek);

  const weeklySourceStats = buildBySourceStats(newThisWeek);

  // 이번 주 신규 진입 종목의 포착 선행성
  const weeklyDetectionLag = buildDetectionLagStats(newThisWeek);

  // exit_reason별 성과 분리
  const weeklyExitReasonPerf = buildExitReasonPerfStats(closedThisWeek);

  return JSON.stringify({
    period: "this_week",
    weekStart,
    weeklySummary: {
      newCount: newThisWeek.length,
      closedCount: closedThisWeek.length,
      weekWinRate:
        closedWithPnl.length > 0
          ? Math.round((winners.length / closedWithPnl.length) * 100)
          : 0,
      weekAvgPnl: Math.round(weekAvgPnl * 100) / 100,
      exitReasons: exitReasonGroups,
    },
    bySource: weeklySourceStats,
    detectionLag: weeklyDetectionLag,
    exitReasonPerf: weeklyExitReasonPerf,
    phaseExits: phaseExits.map((r) => ({
      symbol: r.symbol,
      source: r.source,
      entryDate: r.entry_date,
      entryPhase: r.entry_phase,
      currentPhase: r.current_phase,
      pnlPercent: r.pnl_percent != null ? Math.round(toNum(r.pnl_percent) * 100) / 100 : null,
      daysTracked: r.days_tracked ?? 0,
    })),
    newThisWeek: newThisWeek.map((r) => ({
      symbol: r.symbol,
      source: r.source,
      tier: r.tier,
      date: r.entry_date,
      entryPrice: toNum(r.entry_price),
      currentPrice: r.current_price != null ? toNum(r.current_price) : null,
      pnlPercent: r.pnl_percent != null ? Math.round(toNum(r.pnl_percent) * 100) / 100 : null,
      currentPhase: r.current_phase,
    })),
    closedThisWeek: closedThisWeek.map((r) => ({
      symbol: r.symbol,
      source: r.source,
      tier: r.tier,
      date: r.entry_date,
      exitDate: r.exit_date,
      pnlPercent: r.pnl_percent != null ? Math.round(toNum(r.pnl_percent) * 100) / 100 : null,
      exitReason: r.exit_reason,
      daysTracked: r.days_tracked ?? 0,
    })),
  });
}

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

function buildNonActiveWhere(
  statusFilter: string,
  baseParams: unknown[],
  baseConditions: string[],
): { clause: string; params: unknown[] } {
  const params = [...baseParams];
  const conditions = [...baseConditions];

  if (statusFilter === "EXPIRED") {
    conditions.push(`status = ${addParam(params, "EXPIRED")}`);
  } else if (statusFilter === "EXITED") {
    conditions.push(`status = ${addParam(params, "EXITED")}`);
  } else {
    conditions.push("status <> 'ACTIVE'");
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { clause, params };
}

function buildSummary(
  activeRecs: TrackedStockPerfRow[],
  closedRecs: TrackedStockPerfRow[],
) {
  const closedWithPnl = closedRecs.filter((r) => r.pnl_percent != null);
  const winners = closedWithPnl.filter((r) => toNum(r.pnl_percent) > 0);

  const avgPnl =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((sum, r) => sum + toNum(r.pnl_percent), 0) /
        closedWithPnl.length
      : 0;

  const avgMaxPnl =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((sum, r) => sum + toNum(r.max_pnl_percent), 0) /
        closedWithPnl.length
      : 0;

  const avgDaysTracked =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((sum, r) => sum + (r.days_tracked ?? 0), 0) /
        closedWithPnl.length
      : 0;

  const expiredCount = closedRecs.filter((r) => r.status === "EXPIRED").length;
  const exitedCount = closedRecs.filter((r) => r.status === "EXITED").length;

  return {
    totalCount: activeRecs.length + closedRecs.length,
    activeCount: activeRecs.length,
    expiredCount,
    exitedCount,
    closedCount: closedRecs.length,
    winRate:
      closedWithPnl.length > 0
        ? Math.round((winners.length / closedWithPnl.length) * 100)
        : 0,
    avgPnlPercent: Math.round(avgPnl * 100) / 100,
    avgMaxPnl: Math.round(avgMaxPnl * 100) / 100,
    avgDaysTracked: Math.round(avgDaysTracked),
    exitReasons: groupByExitReason(closedRecs),
  };
}

function buildBySourceStats(rows: TrackedStockPerfRow[]) {
  const sources = ["etl_auto", "agent", "thesis_aligned"] as const;
  return Object.fromEntries(
    sources.map((src) => {
      const srcRows = rows.filter((r) => r.source === src);
      const closedWithPnl = srcRows.filter(
        (r) => r.status !== "ACTIVE" && r.pnl_percent != null,
      );
      const winners = closedWithPnl.filter((r) => toNum(r.pnl_percent) > 0);
      const avgPnl =
        closedWithPnl.length > 0
          ? closedWithPnl.reduce((sum, r) => sum + toNum(r.pnl_percent), 0) /
            closedWithPnl.length
          : 0;

      return [
        src,
        {
          total: srcRows.length,
          active: srcRows.filter((r) => r.status === "ACTIVE").length,
          closed: srcRows.filter((r) => r.status !== "ACTIVE").length,
          winRate:
            closedWithPnl.length > 0
              ? Math.round((winners.length / closedWithPnl.length) * 100)
              : 0,
          avgPnl: Math.round(avgPnl * 100) / 100,
        },
      ];
    }),
  );
}

function buildByTierStats(rows: TrackedStockPerfRow[]) {
  const tiers = ["standard", "featured"] as const;
  return Object.fromEntries(
    tiers.map((tier) => {
      const tierRows = rows.filter((r) => r.tier === tier);
      const closedWithPnl = tierRows.filter(
        (r) => r.status !== "ACTIVE" && r.pnl_percent != null,
      );
      const winners = closedWithPnl.filter((r) => toNum(r.pnl_percent) > 0);
      const avgPnl =
        closedWithPnl.length > 0
          ? closedWithPnl.reduce((sum, r) => sum + toNum(r.pnl_percent), 0) /
            closedWithPnl.length
          : 0;

      return [
        tier,
        {
          total: tierRows.length,
          active: tierRows.filter((r) => r.status === "ACTIVE").length,
          closed: tierRows.filter((r) => r.status !== "ACTIVE").length,
          winRate:
            closedWithPnl.length > 0
              ? Math.round((winners.length / closedWithPnl.length) * 100)
              : 0,
          avgPnl: Math.round(avgPnl * 100) / 100,
        },
      ];
    }),
  );
}

// ─── Detection Lag 계산 ──────────────────────────────────────────────────────

/**
 * entry_date - phase2_since 일수를 계산한다.
 * phase2_since가 null이면 null을 반환한다.
 */
function calcDetectionLag(row: TrackedStockPerfRow): number | null {
  if (row.phase2_since == null) {
    return null;
  }
  const entry = new Date(row.entry_date).getTime();
  const p2 = new Date(row.phase2_since).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((entry - p2) / MS_PER_DAY);
}

type DetectionLagBucket = "early" | "normal" | "late";

function classifyLag(lag: number): DetectionLagBucket {
  if (lag <= 3) return "early";
  if (lag <= 7) return "normal";
  return "late";
}

interface DetectionLagStats {
  sampleSize: number;
  avgLag: number;
  medianLag: number;
  distribution: Record<DetectionLagBucket, number>;
}

function buildDetectionLagStats(rows: TrackedStockPerfRow[]): DetectionLagStats | null {
  const lags = rows
    .map(calcDetectionLag)
    .filter((v): v is number => v != null);

  if (lags.length === 0) {
    return null;
  }

  const sorted = [...lags].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const avg = lags.reduce((s, v) => s + v, 0) / lags.length;

  const distribution: Record<DetectionLagBucket, number> = {
    early: 0,
    normal: 0,
    late: 0,
  };
  for (const lag of lags) {
    distribution[classifyLag(lag)]++;
  }

  return {
    sampleSize: lags.length,
    avgLag: Math.round(avg * 10) / 10,
    medianLag: Math.round(median * 10) / 10,
    distribution,
  };
}

function buildDetectionLagBySource(
  rows: TrackedStockPerfRow[],
): Record<string, DetectionLagStats | null> {
  const sources = ["etl_auto", "agent", "thesis_aligned"] as const;
  return Object.fromEntries(
    sources.map((src) => [
      src,
      buildDetectionLagStats(rows.filter((r) => r.source === src)),
    ]),
  );
}

// ─── Exit Reason 성과 분리 ───────────────────────────────────────────────────

interface ExitReasonPerfStats {
  count: number;
  avgPnl: number;
  winRate: number;
}

function buildExitReasonPerfStats(
  rows: TrackedStockPerfRow[],
): Record<string, ExitReasonPerfStats> {
  const groups: Record<string, TrackedStockPerfRow[]> = {};
  for (const row of rows) {
    if (row.status === "ACTIVE") continue;
    const key = normalizeExitReason(row.exit_reason);
    if (groups[key] == null) groups[key] = [];
    groups[key].push(row);
  }

  return Object.fromEntries(
    Object.entries(groups).map(([key, grp]) => {
      const withPnl = grp.filter((r) => r.pnl_percent != null);
      const winners = withPnl.filter((r) => toNum(r.pnl_percent) > 0);
      const avg =
        withPnl.length > 0
          ? withPnl.reduce((s, r) => s + toNum(r.pnl_percent), 0) / withPnl.length
          : 0;
      return [
        key,
        {
          count: grp.length,
          avgPnl: Math.round(avg * 100) / 100,
          winRate:
            withPnl.length > 0
              ? Math.round((winners.length / withPnl.length) * 100)
              : 0,
        },
      ];
    }),
  );
}

/**
 * exit_reason 문자열을 정규화한다.
 * "phase_exit: 2 → 1" 같은 상세 이유를 "phase_exit"으로 통합.
 */
function normalizeExitReason(reason: string | null): string {
  if (reason == null) return "unknown";
  if (reason.startsWith("phase_exit")) return "phase_exit";
  return reason;
}

function groupByExitReason(rows: TrackedStockPerfRow[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const row of rows) {
    const key = row.exit_reason ?? "unknown";
    groups[key] = (groups[key] ?? 0) + 1;
  }
  return groups;
}

function formatActiveRow(r: TrackedStockPerfRow) {
  return {
    symbol: r.symbol,
    source: r.source,
    tier: r.tier,
    date: r.entry_date,
    entryPrice: toNum(r.entry_price),
    currentPrice: r.current_price != null ? toNum(r.current_price) : null,
    pnlPercent: r.pnl_percent != null ? Math.round(toNum(r.pnl_percent) * 100) / 100 : null,
    maxPnlPercent: r.max_pnl_percent != null ? Math.round(toNum(r.max_pnl_percent) * 100) / 100 : null,
    daysTracked: r.days_tracked ?? 0,
    currentPhase: r.current_phase,
    return7d: r.return_7d != null ? toNum(r.return_7d) : null,
    return30d: r.return_30d != null ? toNum(r.return_30d) : null,
  };
}

function formatClosedRow(r: TrackedStockPerfRow) {
  return {
    symbol: r.symbol,
    source: r.source,
    tier: r.tier,
    date: r.entry_date,
    exitDate: r.exit_date,
    entryPrice: toNum(r.entry_price),
    exitPrice: r.current_price != null ? toNum(r.current_price) : null,
    pnlPercent: r.pnl_percent != null ? Math.round(toNum(r.pnl_percent) * 100) / 100 : null,
    maxPnlPercent: r.max_pnl_percent != null ? Math.round(toNum(r.max_pnl_percent) * 100) / 100 : null,
    daysTracked: r.days_tracked ?? 0,
    status: r.status,
    exitReason: r.exit_reason,
    return7d: r.return_7d != null ? toNum(r.return_7d) : null,
    return30d: r.return_30d != null ? toNum(r.return_30d) : null,
    return90d: r.return_90d != null ? toNum(r.return_90d) : null,
  };
}
