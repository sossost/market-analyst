import { pool } from "@/db/client";
import { MIN_MARKET_CAP } from "@/lib/constants";
import type {
  FundamentalGradeRow,
  FundamentalAccelerationRow,
} from "./types.js";

/**
 * fundamental_scores, quarterly_financials 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * 지정 종목의 가장 최근 SEPA 등급을 조회한다.
 * scored_date <= date 기준으로 최신 레코드를 반환한다.
 */
export async function findLatestFundamentalGrade(
  symbol: string,
  date: string,
): Promise<FundamentalGradeRow | null> {
  const { rows } = await pool.query<FundamentalGradeRow>(
    `SELECT grade FROM fundamental_scores
     WHERE symbol = $1 AND scored_date <= $2
     ORDER BY scored_date DESC
     LIMIT 1`,
    [symbol, date],
  );

  return rows[0] ?? null;
}

/** 복수 종목의 최신 SEPA 등급을 일괄 조회한다. */
export interface FundamentalGradeBatchRow {
  symbol: string;
  grade: string;
}

export async function findFundamentalGrades(
  symbols: string[],
  date: string,
): Promise<FundamentalGradeBatchRow[]> {
  if (symbols.length === 0) return [];

  const { rows } = await pool.query<FundamentalGradeBatchRow>(
    `SELECT DISTINCT ON (symbol) symbol, grade
     FROM fundamental_scores
     WHERE symbol = ANY($1) AND scored_date <= $2
     ORDER BY symbol, scored_date DESC`,
    [symbols, date],
  );

  return rows;
}

/**
 * Phase 1 또는 Phase 2 종목 중 최근 8분기 실적 데이터를 조회한다.
 * getFundamentalAcceleration 전용 — 종목별 그룹화 및 가속 패턴 계산은 호출부에서 수행.
 */
export async function findFundamentalAcceleration(): Promise<FundamentalAccelerationRow[]> {
  const { rows } = await pool.query<FundamentalAccelerationRow>(
    `WITH latest_date AS (
       SELECT MAX(date) AS d FROM stock_phases
     ),
     target_symbols AS (
       SELECT sp.symbol
       FROM stock_phases sp
       JOIN latest_date ld ON sp.date = ld.d
       JOIN symbols s ON sp.symbol = s.symbol
       WHERE sp.phase IN (1, 2)
         AND sp.rs_score >= 20
         AND s.market_cap::numeric >= $1
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
    [MIN_MARKET_CAP],
  );

  return rows;
}
