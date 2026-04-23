/**
 * analyzeTrackedFactors — tracked_stocks 팩터별 성과 슬라이싱 분석 도구.
 *
 * 광망(etl_auto) 수집 모집단에서 어떤 팩터가 실제로 알파를 만드는지
 * 데이터 기반 검증. SEPA등급, RS구간, 섹터, 업종, Phase전이,
 * detection_lag 6축 슬라이싱 + 교차 분석을 제공한다.
 */

import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const MIN_CELL_COUNT = 5;
const MIN_TOTAL_COUNT = 30;

// ─── RS 구간 ──────────────────────────────────────────────────────────────────

type RsBucket = "<50" | "50-69" | "70-89" | "90+";

function classifyRs(score: number | null): RsBucket | "UNKNOWN" {
  if (score == null) return "UNKNOWN";
  if (score < 50) return "<50";
  if (score < 70) return "50-69";
  if (score < 90) return "70-89";
  return "90+";
}

// ─── Detection Lag 구간 ───────────────────────────────────────────────────────

type LagBucket = "early" | "normal" | "late";

function classifyLag(lagDays: number): LagBucket {
  if (lagDays <= 3) return "early";
  if (lagDays <= 7) return "normal";
  return "late";
}

function calcDetectionLag(
  entryDate: string,
  phase2Since: string | null,
): number | null {
  if (phase2Since == null) return null;
  const entry = new Date(entryDate).getTime();
  const p2 = new Date(phase2Since).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((entry - p2) / MS_PER_DAY);
}

// ─── Row Type ─────────────────────────────────────────────────────────────────

interface FactorRow {
  symbol: string;
  source: string;
  status: string;
  entry_date: string;
  entry_sepa_grade: string | null;
  entry_rs_score: number | null;
  entry_sector: string | null;
  entry_industry: string | null;
  entry_phase: number | null;
  entry_prev_phase: number | null;
  phase2_since: string | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  days_tracked: number | null;
}

// ─── 통계 타입 ────────────────────────────────────────────────────────────────

interface SliceStats {
  count: number;
  activeCount: number;
  closedCount: number;
  avgPnl: number | null;
  maxPnl: number | null;
  winRate: number | null;
  avgDaysTracked: number | null;
}

// ─── 도구 정의 ────────────────────────────────────────────────────────────────

export const analyzeTrackedFactors: AgentTool = {
  definition: {
    name: "analyze_tracked_factors",
    description:
      "tracked_stocks 팩터별 성과 슬라이싱 분석. SEPA등급, RS구간, 섹터, 업종, Phase전이, detection_lag 6축 + SEPA×RS, SEPA×섹터 교차 분석. 어떤 팩터가 알파를 만드는지 데이터 기반 검증.",
    input_schema: {
      type: "object" as const,
      properties: {
        source: {
          type: "string",
          enum: ["etl_auto", "agent", "thesis_aligned", "all"],
          description: "소스 필터 (기본 all). 특정 소스만 분석할 때 사용.",
        },
        status: {
          type: "string",
          enum: ["ALL", "ACTIVE", "CLOSED"],
          description:
            "상태 필터. ALL(기본): 전체, ACTIVE: 추적 중만, CLOSED: 종료(EXPIRED+EXITED)만.",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const sourceFilter =
      typeof input.source === "string" && input.source !== "all"
        ? input.source
        : null;
    const statusFilter =
      typeof input.status === "string" ? input.status : "ALL";

    const rows = await fetchRows(sourceFilter, statusFilter);

    if (rows.length === 0) {
      return JSON.stringify({
        warning: "데이터 없음. 필터 조건을 확인하세요.",
        totalCount: 0,
      });
    }

    const meta = buildMeta(rows);
    const bySepa = buildSliceByKey(rows, (r) => r.entry_sepa_grade ?? "UNKNOWN");
    const byRs = buildSliceByKey(rows, (r) => classifyRs(r.entry_rs_score));
    const bySector = buildSliceByKey(rows, (r) => r.entry_sector ?? "UNKNOWN");
    const byIndustry = buildIndustrySlice(rows);
    const byPhaseTransition = buildPhaseTransitionSlice(rows);
    const byDetectionLag = buildDetectionLagSlice(rows);

    const crossSepaRs = buildCrossAnalysis(
      rows,
      (r) => r.entry_sepa_grade ?? "UNKNOWN",
      (r) => classifyRs(r.entry_rs_score),
    );
    const crossSepaSector = buildCrossAnalysis(
      rows,
      (r) => r.entry_sepa_grade ?? "UNKNOWN",
      (r) => r.entry_sector ?? "UNKNOWN",
    );

    return JSON.stringify({
      meta,
      bySepaGrade: bySepa,
      byRsBucket: byRs,
      bySector,
      byIndustry,
      byPhaseTransition,
      byDetectionLag,
      cross: {
        sepaXrs: crossSepaRs,
        sepaXsector: crossSepaSector,
      },
    });
  },
};

// ─── DB 조회 ──────────────────────────────────────────────────────────────────

async function fetchRows(
  sourceFilter: string | null,
  statusFilter: string,
): Promise<FactorRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (sourceFilter != null) {
    params.push(sourceFilter);
    conditions.push(`source = $${params.length}`);
  }

  if (statusFilter === "ACTIVE") {
    conditions.push("status = 'ACTIVE'");
  } else if (statusFilter === "CLOSED") {
    conditions.push("status <> 'ACTIVE'");
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await retryDatabaseOperation(() =>
    pool.query<FactorRow>(
      `SELECT symbol, source, status, entry_date,
              entry_sepa_grade, entry_rs_score, entry_sector, entry_industry,
              entry_phase, entry_prev_phase, phase2_since,
              pnl_percent::text, max_pnl_percent::text, days_tracked
       FROM tracked_stocks
       ${where}
       ORDER BY entry_date DESC`,
      params,
    ),
  );

  return result.rows;
}

// ─── 메타 ─────────────────────────────────────────────────────────────────────

interface FactorMeta {
  totalCount: number;
  activeCount: number;
  closedCount: number;
  nullRates: {
    sepaGrade: number;
    rsScore: number;
    sector: number;
    industry: number;
    prevPhase: number;
    phase2Since: number;
  };
  dataWarning: string | null;
}

function buildMeta(rows: FactorRow[]): FactorMeta {
  const total = rows.length;
  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;

  const nullCount = (fn: (r: FactorRow) => boolean) =>
    rows.filter(fn).length;
  const pct = (n: number) => Math.round((n / total) * 100);

  const closedCount = total - activeCount;

  return {
    totalCount: total,
    activeCount,
    closedCount,
    nullRates: {
      sepaGrade: pct(nullCount((r) => r.entry_sepa_grade == null)),
      rsScore: pct(nullCount((r) => r.entry_rs_score == null)),
      sector: pct(nullCount((r) => r.entry_sector == null)),
      industry: pct(nullCount((r) => r.entry_industry == null)),
      prevPhase: pct(nullCount((r) => r.entry_prev_phase == null)),
      phase2Since: pct(nullCount((r) => r.phase2_since == null)),
    },
    dataWarning:
      closedCount < MIN_TOTAL_COUNT
        ? `종료 건수(${closedCount})가 ${MIN_TOTAL_COUNT}건 미만. 슬라이싱 결과의 통계적 신뢰도 낮음.`
        : null,
  };
}

// ─── 범용 슬라이싱 ────────────────────────────────────────────────────────────

function computeStats(rows: FactorRow[]): SliceStats {
  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const closedRows = rows.filter(
    (r) => r.status !== "ACTIVE" && r.pnl_percent != null,
  );
  const closedCount = rows.filter((r) => r.status !== "ACTIVE").length;

  if (closedRows.length === 0) {
    return {
      count: rows.length,
      activeCount,
      closedCount,
      avgPnl: null,
      maxPnl: null,
      winRate: null,
      avgDaysTracked: null,
    };
  }

  const pnls = closedRows.map((r) => toNum(r.pnl_percent));
  const avgPnl = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const maxPnl = Math.max(...closedRows.map((r) => toNum(r.max_pnl_percent)));
  const winners = pnls.filter((p) => p > 0).length;
  const winRate = Math.round((winners / closedRows.length) * 100);
  const avgDays =
    closedRows.reduce((s, r) => s + (r.days_tracked ?? 0), 0) /
    closedRows.length;

  return {
    count: rows.length,
    activeCount,
    closedCount,
    avgPnl: Math.round(avgPnl * 100) / 100,
    maxPnl: Math.round(maxPnl * 100) / 100,
    winRate,
    avgDaysTracked: Math.round(avgDays),
  };
}

function buildSliceByKey(
  rows: FactorRow[],
  keyFn: (r: FactorRow) => string,
): Record<string, SliceStats> {
  const groups: Record<string, FactorRow[]> = {};
  for (const row of rows) {
    const key = keyFn(row);
    if (groups[key] == null) groups[key] = [];
    groups[key].push(row);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, grp]) => [key, computeStats(grp)]),
  );
}

// ─── 업종 슬라이싱 (최소 3건 이상만) ──────────────────────────────────────────

function buildIndustrySlice(
  rows: FactorRow[],
): Record<string, SliceStats> {
  const MIN_INDUSTRY_COUNT = 3;
  const groups: Record<string, FactorRow[]> = {};

  for (const row of rows) {
    const key = row.entry_industry ?? "UNKNOWN";
    if (groups[key] == null) groups[key] = [];
    groups[key].push(row);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .filter(([, grp]) => grp.length >= MIN_INDUSTRY_COUNT)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, grp]) => [key, computeStats(grp)]),
  );
}

// ─── Phase 전이 슬라이싱 ──────────────────────────────────────────────────────

function buildPhaseTransitionSlice(
  rows: FactorRow[],
): Record<string, SliceStats> {
  const groups: Record<string, FactorRow[]> = {};

  for (const row of rows) {
    const prev = row.entry_prev_phase;
    const curr = row.entry_phase;
    const key =
      prev != null && curr != null
        ? `${prev}→${curr}`
        : curr != null
          ? `?→${curr}`
          : "UNKNOWN";
    if (groups[key] == null) groups[key] = [];
    groups[key].push(row);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, grp]) => [key, computeStats(grp)]),
  );
}

// ─── Detection Lag 슬라이싱 ───────────────────────────────────────────────────

function buildDetectionLagSlice(
  rows: FactorRow[],
): Record<string, SliceStats> {
  const groups: Record<string, FactorRow[]> = {};

  for (const row of rows) {
    const lag = calcDetectionLag(row.entry_date, row.phase2_since);
    const key = lag != null ? classifyLag(lag) : "UNKNOWN";
    if (groups[key] == null) groups[key] = [];
    groups[key].push(row);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, grp]) => [key, computeStats(grp)]),
  );
}

// ─── 교차 분석 ────────────────────────────────────────────────────────────────

function buildCrossAnalysis(
  rows: FactorRow[],
  keyFn1: (r: FactorRow) => string,
  keyFn2: (r: FactorRow) => string,
): Record<string, SliceStats | { insufficient_data: true; count: number }> {
  const groups: Record<string, FactorRow[]> = {};

  for (const row of rows) {
    const key = `${keyFn1(row)} × ${keyFn2(row)}`;
    if (groups[key] == null) groups[key] = [];
    groups[key].push(row);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, grp]) => {
        if (grp.length < MIN_CELL_COUNT) {
          return [key, { insufficient_data: true, count: grp.length }];
        }
        return [key, computeStats(grp)];
      }),
  );
}
