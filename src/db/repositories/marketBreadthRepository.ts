import { pool } from "@/db/client";
import type {
  TradingDateRow,
  PhaseDistributionRow,
  WeeklyTrendRow,
  Phase1to2TransitionsRow,
  PrevPhase2RatioRow,
  MarketAvgRsRow,
  AdvanceDeclineRow,
  NewHighLowRow,
  BreadthTopSectorRow,
  MarketBreadthPhaseDistributionRow,
  MarketBreadthPrevPhase2Row,
  MarketBreadthAvgRsRow,
  MarketBreadthAdRow,
  MarketBreadthHlRow,
  SectorSnapshotRow,
  Phase2StockRow,
  DataDateRow,
  MarketBreadthDailyRow,
} from "./types.js";

/**
 * 시장 브레드스 관련 집계 쿼리 Repository.
 * getMarketBreadth.ts, marketDataLoader.ts 소비자 전용.
 * 재시도 로직은 호출부가 담당한다.
 */

// ─── getMarketBreadth.ts 전용 (symbols JOIN + 3개 필터 포함) ─────────────────

/**
 * 최근 N거래일 날짜 목록을 조회한다 (weekly 모드용).
 * symbols JOIN 없음 — 날짜만 조회.
 */
export async function findTradingDates(
  date: string,
  limit: number,
): Promise<TradingDateRow[]> {
  const { rows } = await pool.query<TradingDateRow>(
    `SELECT DISTINCT date::text FROM stock_phases
     WHERE date <= $1
     ORDER BY date DESC
     LIMIT $2`,
    [date, limit],
  );

  return rows;
}

/**
 * 복수 날짜에 대한 Phase 2 비율 추이를 일괄 조회한다 (weekly 모드용).
 * symbols JOIN + 3개 필터 포함.
 */
export async function findWeeklyTrend(
  dates: string[],
): Promise<WeeklyTrendRow[]> {
  const { rows } = await pool.query<WeeklyTrendRow>(
    `SELECT
       sp.date::text,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE sp.phase = 2)::text AS phase2_count,
       AVG(sp.rs_score)::numeric(10,2)::text AS avg_rs
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = ANY($1::date[])
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false
     GROUP BY sp.date
     ORDER BY sp.date ASC`,
    [dates],
  );

  return rows;
}

/**
 * 복수 날짜에 걸친 Phase 1→2 전환 종목 수 합계를 조회한다 (weekly 모드용).
 * symbols JOIN + 3개 필터 포함.
 */
export async function findWeeklyPhase1to2Transitions(
  dates: string[],
): Promise<Phase1to2TransitionsRow> {
  const { rows } = await pool.query<Phase1to2TransitionsRow>(
    `SELECT COUNT(*)::text AS transitions
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = ANY($1::date[])
       AND sp.phase = 2
       AND sp.prev_phase = 1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [dates],
  );

  return rows[0] ?? { transitions: "0" };
}

/**
 * 단일 날짜의 Phase 분포를 조회한다.
 * symbols JOIN + 3개 필터 포함.
 */
export async function findPhaseDistribution(
  date: string,
): Promise<PhaseDistributionRow[]> {
  const { rows } = await pool.query<PhaseDistributionRow>(
    `SELECT sp.phase, COUNT(*)::text AS count
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false
     GROUP BY sp.phase
     ORDER BY sp.phase`,
    [date],
  );

  return rows;
}

/**
 * 전일 Phase 2 비율을 조회한다 (daily 모드 변화 계산용).
 * symbols JOIN + 3개 필터 포함.
 */
export async function findPrevDayPhase2Ratio(
  date: string,
): Promise<PrevPhase2RatioRow> {
  const { rows } = await pool.query<PrevPhase2RatioRow>(
    `SELECT
       COUNT(*) FILTER (WHERE sp.phase = 2)::text AS phase2_count,
       COUNT(*)::text AS total_count
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = (SELECT MAX(sp2.date) FROM stock_phases sp2
                     JOIN symbols s2 ON sp2.symbol = s2.symbol
                     WHERE sp2.date < $1
                       AND s2.is_actively_trading = true
                       AND s2.is_etf = false
                       AND s2.is_fund = false)
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return rows[0] ?? { phase2_count: "0", total_count: "0" };
}

/**
 * 시장 평균 RS를 조회한다.
 * symbols JOIN + 3개 필터 포함.
 */
export async function findMarketAvgRs(
  date: string,
): Promise<MarketAvgRsRow> {
  const { rows } = await pool.query<MarketAvgRsRow>(
    `SELECT AVG(sp.rs_score)::numeric(10,2)::text AS avg_rs
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return rows[0] ?? { avg_rs: "0" };
}

/**
 * Advance/Decline ratio를 조회한다.
 * symbols JOIN + 3개 필터 포함 (getMarketBreadth.ts 버전 — unchanged 포함).
 */
export async function findAdvanceDecline(
  date: string,
): Promise<AdvanceDeclineRow> {
  const { rows } = await pool.query<AdvanceDeclineRow>(
    `SELECT
       COUNT(*) FILTER (WHERE dp.close::numeric > dp_prev.close::numeric)::text AS advancers,
       COUNT(*) FILTER (WHERE dp.close::numeric < dp_prev.close::numeric)::text AS decliners,
       COUNT(*) FILTER (WHERE dp.close::numeric = dp_prev.close::numeric)::text AS unchanged
     FROM daily_prices dp
     JOIN daily_prices dp_prev
       ON dp.symbol = dp_prev.symbol
       AND dp_prev.date = (SELECT MAX(date) FROM daily_prices WHERE date < $1)
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return rows[0] ?? { advancers: "0", decliners: "0", unchanged: "0" };
}

/**
 * 52주 신고가/신저가를 조회한다.
 * symbols JOIN + 3개 필터 포함 (getMarketBreadth.ts 버전).
 */
export async function findNewHighLow(
  date: string,
): Promise<NewHighLowRow> {
  const { rows } = await pool.query<NewHighLowRow>(
    `WITH yearly_range AS (
       SELECT symbol,
         MAX(high::numeric) AS high_52w,
         MIN(low::numeric) AS low_52w
       FROM daily_prices
       WHERE date::date BETWEEN ($1::date - INTERVAL '365 days')::date AND ($1::date - INTERVAL '1 day')::date
       GROUP BY symbol
     )
     SELECT
       COUNT(*) FILTER (WHERE dp.close::numeric >= yr.high_52w)::text AS new_highs,
       COUNT(*) FILTER (WHERE dp.close::numeric <= yr.low_52w)::text AS new_lows
     FROM daily_prices dp
     JOIN yearly_range yr ON dp.symbol = yr.symbol
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1::text
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return rows[0] ?? { new_highs: "0", new_lows: "0" };
}

/**
 * 상위 N개 섹터 요약을 조회한다 (getMarketBreadth.ts 버전).
 */
export async function findBreadthTopSectors(
  date: string,
  limit: number,
): Promise<BreadthTopSectorRow[]> {
  const { rows } = await pool.query<BreadthTopSectorRow>(
    `SELECT sector, avg_rs::text, group_phase
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC
     LIMIT $2`,
    [date, limit],
  );

  return rows;
}

// ─── Phase 2 종목 조회 공유 상수 ─────────────────────────────────────────────

/**
 * 5일/20일 가격 변화율을 계산하는 LATERAL JOIN 절.
 * findNewPhase2Stocks, findTopPhase2Stocks 에서 공유.
 */
const MOMENTUM_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      (dp_now.close - dp_5d.close) / NULLIF(dp_5d.close, 0) AS change_5d,
      (dp_now.close - dp_20d.close) / NULLIF(dp_20d.close, 0) AS change_20d
    FROM daily_prices dp_now
    LEFT JOIN LATERAL (
      SELECT close FROM daily_prices
      WHERE symbol = sp.symbol AND date < $1
      ORDER BY date DESC OFFSET 4 LIMIT 1
    ) dp_5d ON true
    LEFT JOIN LATERAL (
      SELECT close FROM daily_prices
      WHERE symbol = sp.symbol AND date < $1
      ORDER BY date DESC OFFSET 19 LIMIT 1
    ) dp_20d ON true
    WHERE dp_now.symbol = sp.symbol AND dp_now.date = $1
  ) momentum ON true`;

// ─── marketDataLoader.ts 전용 (symbols JOIN 없는 버전) ───────────────────────

/**
 * Phase 분포를 조회한다 (marketDataLoader.ts 버전 — symbols 필터 없음).
 */
export async function findMarketBreadthPhaseDistribution(
  date: string,
): Promise<MarketBreadthPhaseDistributionRow[]> {
  const { rows } = await pool.query<MarketBreadthPhaseDistributionRow>(
    `SELECT phase, COUNT(*)::text AS count
     FROM stock_phases WHERE date = $1
     GROUP BY phase ORDER BY phase`,
    [date],
  );

  return rows;
}

/**
 * 전일 Phase 2 비율을 조회한다 (marketDataLoader.ts 버전 — symbols 필터 없음).
 */
export async function findMarketBreadthPrevPhase2(
  date: string,
): Promise<MarketBreadthPrevPhase2Row> {
  const { rows } = await pool.query<MarketBreadthPrevPhase2Row>(
    `SELECT
       COUNT(*) FILTER (WHERE phase = 2)::text AS phase2_count,
       COUNT(*)::text AS total_count
     FROM stock_phases
     WHERE date = (SELECT MAX(date) FROM stock_phases WHERE date < $1)`,
    [date],
  );

  return rows[0] ?? { phase2_count: "0", total_count: "0" };
}

/**
 * 시장 평균 RS를 조회한다 (marketDataLoader.ts 버전 — symbols 필터 없음).
 */
export async function findMarketBreadthAvgRs(
  date: string,
): Promise<MarketBreadthAvgRsRow> {
  const { rows } = await pool.query<MarketBreadthAvgRsRow>(
    `SELECT AVG(rs_score)::numeric(10,2)::text AS avg_rs FROM stock_phases WHERE date = $1`,
    [date],
  );

  return rows[0] ?? { avg_rs: "0" };
}

/**
 * Advance/Decline ratio를 조회한다 (marketDataLoader.ts 버전 — unchanged 없음).
 * graceful degradation을 위해 Promise를 반환한다 (.catch는 호출부에서 처리).
 */
export async function findMarketBreadthAdvanceDecline(
  date: string,
): Promise<MarketBreadthAdRow[]> {
  const { rows } = await pool.query<MarketBreadthAdRow>(
    `SELECT
       COUNT(*) FILTER (WHERE dp.close::numeric > dp_prev.close::numeric)::text AS advancers,
       COUNT(*) FILTER (WHERE dp.close::numeric < dp_prev.close::numeric)::text AS decliners
     FROM daily_prices dp
     JOIN daily_prices dp_prev
       ON dp.symbol = dp_prev.symbol
       AND dp_prev.date = (SELECT MAX(date) FROM daily_prices WHERE date < $1)
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return rows;
}

/**
 * 52주 신고가/신저가를 조회한다 (marketDataLoader.ts 버전).
 * graceful degradation을 위해 Promise를 반환한다 (.catch는 호출부에서 처리).
 */
export async function findMarketBreadthNewHighLow(
  date: string,
): Promise<MarketBreadthHlRow[]> {
  const { rows } = await pool.query<MarketBreadthHlRow>(
    `WITH yearly_range AS (
       SELECT symbol,
         MAX(high::numeric) AS high_52w,
         MIN(low::numeric) AS low_52w
       FROM daily_prices
       WHERE date::date BETWEEN ($1::date - INTERVAL '365 days')::date AND ($1::date - INTERVAL '1 day')::date
       GROUP BY symbol
     )
     SELECT
       COUNT(*) FILTER (WHERE dp.close::numeric >= yr.high_52w)::text AS new_highs,
       COUNT(*) FILTER (WHERE dp.close::numeric <= yr.low_52w)::text AS new_lows
     FROM daily_prices dp
     JOIN yearly_range yr ON dp.symbol = yr.symbol
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1::text
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return rows;
}

/**
 * sector_rs_daily에서 섹터 스냅샷을 조회한다 (marketDataLoader.ts 버전).
 */
export async function findSectorSnapshot(
  date: string,
): Promise<SectorSnapshotRow[]> {
  const { rows } = await pool.query<SectorSnapshotRow>(
    `SELECT sector, avg_rs::text, rs_rank, group_phase, prev_group_phase,
            change_4w::text, change_12w::text,
            phase2_ratio::text, phase1to2_count_5d
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC`,
    [date],
  );

  return rows;
}

/**
 * Phase 2 신규 진입 종목을 조회한다 (prev_phase != 2, marketDataLoader.ts 버전).
 */
export async function findNewPhase2Stocks(
  date: string,
  minMarketCap: number,
): Promise<Phase2StockRow[]> {

  const { rows } = await pool.query<Phase2StockRow>(
    `SELECT sp.symbol, sp.rs_score, sp.prev_phase, s.sector, s.industry,
            sp.volume_confirmed, sp.pct_from_high_52w::text, s.market_cap::text,
            momentum.change_5d::text AS price_change_5d,
            momentum.change_20d::text AS price_change_20d
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     ${MOMENTUM_JOIN}
     WHERE sp.date = $1
       AND sp.phase = 2
       AND sp.prev_phase IS NOT NULL
       AND sp.prev_phase != 2
       AND (s.market_cap IS NULL OR s.market_cap::numeric >= $2)
     ORDER BY sp.rs_score DESC
     LIMIT 20`,
    [date, minMarketCap],
  );

  return rows;
}

/**
 * Phase 2 RS 상위 종목을 조회한다 (marketDataLoader.ts 버전).
 */
export async function findTopPhase2Stocks(
  date: string,
  minMarketCap: number,
): Promise<Phase2StockRow[]> {

  const { rows } = await pool.query<Phase2StockRow>(
    `SELECT sp.symbol, sp.rs_score, sp.prev_phase, s.sector, s.industry,
            sp.volume_confirmed, sp.pct_from_high_52w::text, s.market_cap::text,
            momentum.change_5d::text AS price_change_5d,
            momentum.change_20d::text AS price_change_20d
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     ${MOMENTUM_JOIN}
     WHERE sp.date = $1
       AND sp.phase = 2
       AND sp.rs_score >= 80
       AND (s.market_cap IS NULL OR s.market_cap::numeric >= $2)
     ORDER BY sp.rs_score DESC
     LIMIT 15`,
    [date, minMarketCap],
  );

  return rows;
}

/**
 * 데이터가 있는 가장 최근 날짜를 조회한다 (marketDataLoader.ts resolveDataDate용).
 */
export async function findLatestDataDate(
  requestedDate: string,
): Promise<DataDateRow> {
  const { rows } = await pool.query<DataDateRow>(
    `SELECT MAX(date) AS date FROM stock_phases WHERE date <= $1`,
    [requestedDate],
  );

  return rows[0] ?? { date: requestedDate };
}

// ─── market_breadth_daily 스냅샷 조회 ─────────────────────────────────────────

/**
 * 단일 날짜의 시장 브레드스 스냅샷을 조회한다.
 * 해당 날짜 데이터가 없으면 null을 반환한다 (throw 아님).
 */
export async function findMarketBreadthSnapshot(
  date: string,
): Promise<MarketBreadthDailyRow | null> {
  const { rows } = await pool.query<MarketBreadthDailyRow>(
    `SELECT
       date::text,
       total_stocks,
       phase1_count,
       phase2_count,
       phase3_count,
       phase4_count,
       phase2_ratio::text,
       phase2_ratio_change::text,
       phase1_to2_count_5d,
       market_avg_rs::text,
       advancers,
       decliners,
       unchanged,
       ad_ratio::text,
       new_highs,
       new_lows,
       hl_ratio::text,
       vix_close::text,
       fear_greed_score,
       fear_greed_rating,
       created_at::text
     FROM market_breadth_daily
     WHERE date = $1`,
    [date],
  );

  return rows[0] ?? null;
}

/**
 * 복수 날짜에 대한 시장 브레드스 스냅샷을 일괄 조회한다 (weekly 모드용).
 * 날짜 오름차순 정렬.
 */
export async function findMarketBreadthSnapshots(
  dates: string[],
): Promise<MarketBreadthDailyRow[]> {
  if (dates.length === 0) return [];

  const { rows } = await pool.query<MarketBreadthDailyRow>(
    `SELECT
       date::text,
       total_stocks,
       phase1_count,
       phase2_count,
       phase3_count,
       phase4_count,
       phase2_ratio::text,
       phase2_ratio_change::text,
       phase1_to2_count_5d,
       market_avg_rs::text,
       advancers,
       decliners,
       unchanged,
       ad_ratio::text,
       new_highs,
       new_lows,
       hl_ratio::text,
       vix_close::text,
       fear_greed_score,
       fear_greed_rating,
       created_at::text
     FROM market_breadth_daily
     WHERE date = ANY($1::text[])
     ORDER BY date ASC`,
    [dates],
  );

  return rows;
}
