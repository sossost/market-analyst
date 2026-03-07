import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateNumber } from "./validation";

const DEFAULT_LIMIT = 20;
const MIN_QUARTERS = 3;

interface QuarterRow {
  symbol: string;
  period_end_date: string;
  eps_diluted: string | null;
  revenue: string | null;
  net_income: string | null;
  sector: string | null;
  industry: string | null;
}

interface AccelerationResult {
  symbol: string;
  sector: string | null;
  industry: string | null;
  epsGrowths: { quarter: string; yoyGrowth: number }[];
  revenueGrowths: { quarter: string; yoyGrowth: number }[];
  isEpsAccelerating: boolean;
  isRevenueAccelerating: boolean;
  latestEpsGrowth: number | null;
  latestRevenueGrowth: number | null;
}

/**
 * EPS/매출 가속 패턴을 보이는 종목을 조회한다.
 * 분기 YoY 성장률이 연속 증가하는 패턴 (ex: +20% → +30% → +40%).
 */
export const getFundamentalAcceleration: AgentTool = {
  definition: {
    name: "get_fundamental_acceleration",
    description:
      "분기 EPS/매출 성장률이 가속하는 종목을 조회합니다. YoY 성장률이 연속 증가하는 패턴(예: Q1 +20% → Q2 +30% → Q3 +40%)을 감지합니다. 실적 전환 초기 포착 목적.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "최대 반환 종목 수 (기본 20)",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const limit = validateNumber(input.limit, DEFAULT_LIMIT);

    // 최근 8분기 실적 데이터 — Phase 1 or 2 종목만
    const { rows } = await retryDatabaseOperation(() =>
      pool.query<QuarterRow>(
        `WITH latest_date AS (
           SELECT MAX(date) AS d FROM stock_phases
         ),
         target_symbols AS (
           SELECT sp.symbol
           FROM stock_phases sp, latest_date ld
           WHERE sp.date = ld.d
             AND sp.phase IN (1, 2)
             AND sp.rs_score >= 20
         )
         SELECT
           qf.symbol,
           qf.period_end_date,
           qf.eps_diluted::text,
           qf.revenue::text,
           qf.net_income::text,
           s.sector,
           s.industry
         FROM quarterly_financials qf
         JOIN target_symbols ts ON qf.symbol = ts.symbol
         JOIN symbols s ON qf.symbol = s.symbol
         WHERE qf.period_end_date >= (CURRENT_DATE - INTERVAL '2 years')::text
         ORDER BY qf.symbol, qf.period_end_date DESC`,
      ),
    );

    // 종목별 그룹화
    const bySymbol = new Map<string, { sector: string | null; industry: string | null; quarters: QuarterRow[] }>();
    for (const row of rows) {
      const entry = bySymbol.get(row.symbol) ?? { sector: row.sector, industry: row.industry, quarters: [] };
      entry.quarters.push(row);
      bySymbol.set(row.symbol, entry);
    }

    // 가속 패턴 감지
    const accelerating: AccelerationResult[] = [];

    for (const [symbol, data] of bySymbol) {
      const quarters = data.quarters; // 최신순
      if (quarters.length < MIN_QUARTERS * 2) continue; // YoY 비교에 최소 6분기 필요

      const epsGrowths = computeYoYGrowths(quarters, "eps_diluted");
      const revenueGrowths = computeYoYGrowths(quarters, "revenue");

      const isEpsAccelerating = isAccelerating(epsGrowths);
      const isRevenueAccelerating = isAccelerating(revenueGrowths);

      if (!isEpsAccelerating && !isRevenueAccelerating) continue;

      accelerating.push({
        symbol,
        sector: data.sector,
        industry: data.industry,
        epsGrowths: epsGrowths.slice(0, 4),
        revenueGrowths: revenueGrowths.slice(0, 4),
        isEpsAccelerating,
        isRevenueAccelerating,
        latestEpsGrowth: epsGrowths[0]?.yoyGrowth ?? null,
        latestRevenueGrowth: revenueGrowths[0]?.yoyGrowth ?? null,
      });
    }

    // 최신 EPS 성장률 높은 순 정렬
    accelerating.sort((a, b) => (b.latestEpsGrowth ?? 0) - (a.latestEpsGrowth ?? 0));

    return JSON.stringify({
      totalFound: accelerating.length,
      description: "EPS 또는 매출 YoY 성장률이 연속 가속하는 종목 (Phase 1~2, RS 20+)",
      stocks: accelerating.slice(0, limit),
    });
  },
};

/**
 * 분기별 YoY 성장률 계산.
 * quarters는 최신순 정렬 가정.
 */
export function computeYoYGrowths(
  quarters: QuarterRow[],
  field: "eps_diluted" | "revenue",
): { quarter: string; yoyGrowth: number }[] {
  const growths: { quarter: string; yoyGrowth: number }[] = [];

  for (let i = 0; i < quarters.length - 4; i++) {
    const current = quarters[i];
    const yearAgo = quarters[i + 4]; // 4분기 전 = 1년 전

    const currentVal = current[field] != null ? toNum(current[field]!) : null;
    const yearAgoVal = yearAgo[field] != null ? toNum(yearAgo[field]!) : null;

    if (currentVal == null || yearAgoVal == null || yearAgoVal === 0) continue;

    const growth = ((currentVal - yearAgoVal) / Math.abs(yearAgoVal)) * 100;
    growths.push({
      quarter: current.period_end_date,
      yoyGrowth: Number(growth.toFixed(1)),
    });
  }

  return growths;
}

/**
 * 가속 패턴 감지: 최근 3개 분기의 YoY 성장률이 연속 증가.
 * growths는 최신순.
 */
export function isAccelerating(growths: { yoyGrowth: number }[]): boolean {
  if (growths.length < MIN_QUARTERS) return false;

  // 최근 3개: growths[0] > growths[1] > growths[2] (최신이 가장 높음)
  // 추가 조건: 최신 성장률이 양수 (축소가 아닌 성장이어야)
  const [latest, prev, older] = growths;
  return (
    latest.yoyGrowth > 0 &&
    latest.yoyGrowth > prev.yoyGrowth &&
    prev.yoyGrowth > older.yoyGrowth
  );
}
