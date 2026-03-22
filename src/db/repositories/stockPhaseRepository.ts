import { pool } from "@/db/client";
import type {
  StockPhaseRow,
  UnusualPhaseCountRow,
  StockPhaseDetailRow,
  StockPhaseFullRow,
  MarketPhase2RatioRow,
  Phase2PersistenceBySymbolRow,
  UnusualStockRow,
  RisingRsStockRow,
  Phase1LateStockRow,
} from "./types.js";

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

/**
 * 개별 종목의 Phase 팩터 스냅샷을 조회한다.
 * saveRecommendations의 팩터 저장 및 getStockDetail 팩터용.
 */
export async function findStockPhaseDetail(
  symbol: string,
  date: string,
): Promise<StockPhaseDetailRow | null> {
  const { rows } = await pool.query<StockPhaseDetailRow>(
    `SELECT rs_score, phase, ma150_slope, vol_ratio, volume_confirmed,
            pct_from_high_52w, pct_from_low_52w, conditions_met
     FROM stock_phases WHERE symbol = $1 AND date = $2`,
    [symbol, date],
  );

  return rows[0] ?? null;
}

/**
 * 개별 종목의 Phase 전체 데이터를 조회한다 (getStockDetail 전용).
 * ma150 컬럼 포함 — stockPhaseDetail과 구분.
 */
export async function findStockPhaseFull(
  symbol: string,
  date: string,
): Promise<StockPhaseFullRow | null> {
  const { rows } = await pool.query<StockPhaseFullRow>(
    `SELECT phase, prev_phase, rs_score,
            ma150::text, ma150_slope::text,
            pct_from_high_52w::text, pct_from_low_52w::text,
            conditions_met
     FROM stock_phases
     WHERE symbol = $1 AND date = $2`,
    [symbol, date],
  );

  return rows[0] ?? null;
}

/**
 * 시장 전체의 Phase 2 비율을 조회한다 (saveRecommendations 팩터용).
 * symbols JOIN 없음 — 팩터 스냅샷 저장 목적.
 */
export async function findMarketPhase2Ratio(
  date: string,
): Promise<MarketPhase2RatioRow> {
  const { rows } = await pool.query<MarketPhase2RatioRow>(
    `SELECT
       ROUND(COUNT(*) FILTER (WHERE phase = 2)::numeric / NULLIF(COUNT(*), 0) * 100, 1)::text AS phase2_ratio
     FROM stock_phases WHERE date = $1`,
    [date],
  );

  return rows[0] ?? { phase2_ratio: null };
}

/**
 * 단일 종목의 Phase 2 지속성 카운트를 조회한다 (bearExceptionGate 전용).
 */
export async function findPhase2PersistenceBySymbol(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<Phase2PersistenceBySymbolRow> {
  const { rows } = await pool.query<Phase2PersistenceBySymbolRow>(
    `SELECT COUNT(*) AS phase2_count
     FROM stock_phases
     WHERE symbol = $1
       AND date >= $2
       AND date <= $3
       AND phase >= 2`,
    [symbol, startDate, endDate],
  );

  return rows[0] ?? { phase2_count: "0" };
}

/**
 * 복합 조건으로 특이종목을 조회한다 (getUnusualStocks 전용).
 * 등락률, 거래량, Phase 전환 조건 중 하나 이상 충족 종목.
 */
export async function findUnusualStocks(
  date: string,
  bigMoveThreshold: number,
  highVolumeRatio: number,
): Promise<UnusualStockRow[]> {
  const { rows } = await pool.query<UnusualStockRow>(
    `SELECT
       dp.symbol,
       dp.close::text,
       dp_prev.close::text AS prev_close,
       ((dp.close::numeric - dp_prev.close::numeric) / NULLIF(dp_prev.close::numeric, 0))::text AS daily_return,
       dp.volume::text,
       dm.vol_ma30::text,
       (dp.volume::numeric / NULLIF(dm.vol_ma30::numeric, 0))::text AS vol_ratio,
       sp.phase,
       sp.prev_phase,
       sp.rs_score,
       s.sector,
       s.industry,
       s.company_name
     FROM daily_prices dp
     JOIN daily_prices dp_prev
       ON dp.symbol = dp_prev.symbol
       AND dp_prev.date = (SELECT MAX(date) FROM daily_prices WHERE date < $1)
     JOIN daily_ma dm
       ON dp.symbol = dm.symbol AND dm.date = $1
     JOIN stock_phases sp
       ON dp.symbol = sp.symbol AND sp.date = $1
     JOIN symbols s
       ON dp.symbol = s.symbol
     WHERE dp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false
       AND dm.vol_ma30::numeric > 0
       AND dp_prev.close::numeric > 0
       AND (
         ABS((dp.close::numeric - dp_prev.close::numeric) / dp_prev.close::numeric) >= $2
         OR dp.volume::numeric / NULLIF(dm.vol_ma30::numeric, 0) >= $3
         OR (sp.prev_phase IS NOT NULL AND sp.prev_phase != sp.phase)
       )`,
    [date, bigMoveThreshold, highVolumeRatio],
  );

  return rows;
}

/**
 * RS 하강→상승 초기 종목을 조회한다 (getRisingRS 전용).
 * RS 범위 + 4주 대비 RS 상승 + 섹터 RS JOIN.
 */
export async function findRisingRsStocks(params: {
  date: string;
  rsMin: number;
  rsMax: number;
  limit: number;
  minRsChange: number;
}): Promise<RisingRsStockRow[]> {
  const { date, rsMin, rsMax, limit, minRsChange } = params;

  const { rows } = await pool.query<RisingRsStockRow>(
    `WITH rs_4w AS (
       SELECT sp.symbol, sp.rs_score AS rs_score_4w_ago
       FROM stock_phases sp
       WHERE sp.date = (
         SELECT MAX(date) FROM stock_phases
         WHERE date <= ($1::date - INTERVAL '28 days')::text
       )
     )
     SELECT
       sp.symbol, sp.phase, sp.rs_score,
       r4w.rs_score_4w_ago,
       (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) AS rs_change,
       sp.ma150_slope::text,
       sp.pct_from_low_52w::text,
       sp.vol_ratio::text,
       s.sector, s.industry,
       srd.avg_rs::text AS sector_avg_rs,
       srd.change_4w::text AS sector_change_4w,
       srd.group_phase AS sector_group_phase
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     LEFT JOIN rs_4w r4w ON r4w.symbol = sp.symbol
     LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
     WHERE sp.date = $1
       AND sp.rs_score >= $2
       AND sp.rs_score <= $3
       AND (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) >= $5
     ORDER BY
       CASE WHEN srd.change_4w::numeric > 0 THEN 0 ELSE 1 END,
       (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) DESC,
       sp.rs_score DESC
     LIMIT $4`,
    [date, rsMin, rsMax, limit, minRsChange],
  );

  return rows;
}

/**
 * Phase 1 후기 종목을 조회한다 (getPhase1LateStocks 전용).
 * MA150 기울기 양전환 조짐 + 거래량 증가 + RS 30+ 조건.
 */
export async function findPhase1LateStocks(
  date: string,
  limit: number,
): Promise<Phase1LateStockRow[]> {
  const { rows } = await pool.query<Phase1LateStockRow>(
    `SELECT
       sp.symbol, sp.phase, sp.prev_phase, sp.rs_score,
       sp.ma150_slope::text, sp.pct_from_high_52w::text, sp.pct_from_low_52w::text,
       sp.conditions_met, sp.vol_ratio::text,
       s.sector, s.industry,
       srd.group_phase AS sector_group_phase,
       srd.avg_rs::text AS sector_avg_rs
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
     WHERE sp.date = $1
       AND sp.phase = 1
       AND (sp.prev_phase IS NULL OR sp.prev_phase = 1)
       AND sp.ma150_slope::numeric > -0.001
       AND sp.rs_score >= 30
       AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.5
     ORDER BY sp.ma150_slope::numeric DESC, sp.rs_score DESC
     LIMIT $2`,
    [date, limit],
  );

  return rows;
}
