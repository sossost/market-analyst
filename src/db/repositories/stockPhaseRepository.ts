import { pool } from "@/db/client";
import type { StockPhaseRow, UnusualPhaseCountRow } from "./types.js";

/**
 * stock_phases 테이블 중심 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * Phase 2 초입 종목 리스트를 조회한다.
 * RS 필터링 + Phase 전환 정보 포함.
 */
export async function findPhase2Stocks(params: {
  date: string;
  minRs: number;
  maxRs: number;
  limit: number;
}): Promise<StockPhaseRow[]> {
  const { date, minRs, maxRs, limit } = params;

  const { rows } = await pool.query<StockPhaseRow>(
    `SELECT
       sp.symbol, sp.phase, sp.prev_phase, sp.rs_score,
       sp.ma150_slope::text, sp.pct_from_high_52w::text, sp.pct_from_low_52w::text,
       sp.conditions_met,
       sp.vol_ratio::text, sp.volume_confirmed,
       s.sector, s.industry
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND sp.phase = 2
       AND sp.rs_score >= $2
       AND sp.rs_score <= $3
     ORDER BY sp.rs_score DESC
     LIMIT $4`,
    [date, minRs, maxRs, limit],
  );

  return rows;
}

/**
 * Phase 1→2 전환 + 거래량 급증 종목 수를 조회한다.
 */
export async function countUnusualPhaseStocks(
  date: string,
): Promise<UnusualPhaseCountRow> {
  const { rows } = await pool.query<UnusualPhaseCountRow>(
    `SELECT COUNT(*)::text AS cnt FROM stock_phases
     WHERE date = $1
       AND phase = 2 AND prev_phase = 1
       AND vol_ratio >= 2.0`,
    [date],
  );

  return rows[0] ?? { cnt: "0" };
}
