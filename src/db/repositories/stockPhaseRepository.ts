import { pool } from "@/db/client";
import { MIN_MARKET_CAP } from "@/lib/constants";
import type { Pool } from "pg";
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
  EtlSymbolRow,
  EtlStartDateRow,
  EtlCloseRow,
  EtlMaRow,
  EtlVolumeRow,
  EtlVolumeHistoryRow,
  EtlRsScoreRow,
  EtlHighLowRow,
  EtlPrevPhaseRow,
  EtlPhaseCountRow,
  EtlSectorCountRow,
  EtlBreadthCheckRow,
  EtlNullIndustryRow,
  EtlTopSectorRow,
  EtlKnownStockRow,
  EtlSignalTransitionRow,
  EtlExistingSignalRow,
  EtlCurrentDataRow,
  EtlTradingDaysRow,
  EtlPhaseExitRow,
  EtlRecommendationDataRow,
  QaTopSectorRow,
  QaPhase2RatioRow,
  QaStockPhaseRow,
  QaSectorPhaseRow,
  LagStatsSectorPhase2Row,
  LagStatsIndustryPhase2Row,
  CrossReportDailyRow,
  CrossReportThesisRow,
  ReportLogPhase2CountRow,
  WeeklyQaThesisWeeklyRow,
  WeeklyQaThesisOverallRow,
  WeeklyQaRecommendationRow,
  WeeklyQaLearningRow,
  WeeklyQaReportLogRow,
  WeeklyQaVerificationMethodRow,
  WeeklyQaBiasMetricsRow,
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
       AND s.market_cap::numeric >= $5
     ORDER BY sp.rs_score DESC
     LIMIT $4`,
    [date, minRs, maxRs, limit, MIN_MARKET_CAP],
  );

  return rows;
}

/**
 * 오늘 날짜 Phase 2 종목 전수를 조회한다 (ETL 자동 스캔 전용).
 * RS/시가총액 필터 없이 순수 Phase 2 전체를 반환한다.
 * 게이트 로직은 호출부(scan-recommendation-candidates)에서 적용한다.
 */
export async function findAllPhase2Stocks(date: string): Promise<StockPhaseRow[]> {
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
     ORDER BY sp.rs_score DESC`,
    [date],
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
       AND phase = 2`,
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
       AND s.industry != 'Shell Companies'
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
 * Phase 필터 + RS 범위 + 4주 대비 RS 상승 + 섹터 RS JOIN.
 */
export async function findRisingRsStocks(params: {
  date: string;
  rsMin: number;
  rsMax: number;
  limit: number;
  minRsChange: number;
  allowedPhases: number[];
}): Promise<RisingRsStockRow[]> {
  const { date, rsMin, rsMax, limit, minRsChange, allowedPhases } = params;

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
     WHERE sp.date = $1::text
       AND sp.rs_score >= $2
       AND sp.rs_score <= $3
       AND (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) >= $5
       AND sp.phase = ANY($6::int[])
       AND s.market_cap::numeric >= $7
     ORDER BY
       CASE WHEN srd.change_4w::numeric > 0 THEN 0 ELSE 1 END,
       (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) DESC,
       sp.rs_score DESC
     LIMIT $4`,
    [date, rsMin, rsMax, limit, minRsChange, allowedPhases, MIN_MARKET_CAP],
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
    `WITH trading_boundary AS (
       SELECT MIN(d.date) AS min_date FROM (
         SELECT DISTINCT date FROM stock_phases
         WHERE date <= $1
         ORDER BY date DESC LIMIT 20
       ) d
     )
     SELECT
       sp.symbol, sp.phase, sp.prev_phase, sp.rs_score,
       sp.ma150_slope::text, sp.pct_from_high_52w::text, sp.pct_from_low_52w::text,
       sp.conditions_met, sp.vol_ratio::text, sp.vdu_ratio::text,
       s.sector, s.industry,
       srd.group_phase AS sector_group_phase,
       srd.avg_rs::text AS sector_avg_rs
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
     WHERE sp.date = $1
       AND sp.phase = 1
       AND (sp.prev_phase IS NULL OR sp.prev_phase = 1)
       AND sp.ma150_slope::numeric >= 0
       AND sp.rs_score >= 30
       AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.0
       AND s.market_cap::numeric >= $3
       AND (
         SELECT COUNT(*)
         FROM stock_phases sp2
         WHERE sp2.symbol = sp.symbol
           AND sp2.date >= (SELECT min_date FROM trading_boundary)
           AND sp2.date <= $1
           AND sp2.vdu_ratio IS NOT NULL
           AND sp2.vdu_ratio::numeric <= 0.5
       ) >= 3
     ORDER BY sp.ma150_slope::numeric DESC, sp.rs_score DESC
     LIMIT $2`,
    [date, limit, MIN_MARKET_CAP],
  );

  return rows;
}

// ─── ETL: build-stock-phases 전용 ────────────────────────────────────────────

/**
 * 활성 비-ETF 종목 전체를 조회한다 (build-stock-phases 전용).
 */
export async function findActiveNonEtfSymbols(): Promise<EtlSymbolRow[]> {
  const { rows } = await pool.query<EtlSymbolRow>(
    `SELECT symbol, sector, industry FROM symbols
     WHERE is_actively_trading = true AND is_etf = false AND is_fund = false
       AND industry != 'Shell Companies'
     ORDER BY symbol`,
  );
  return rows;
}

/**
 * 52주 시작 날짜를 계산한다 (build-stock-phases 전용).
 * targetDate 이하 최근 highLowDays 번째 거래일을 반환한다.
 */
export async function findHighLowStartDate(
  targetDate: string,
  highLowDays: number,
): Promise<EtlStartDateRow | null> {
  const { rows } = await pool.query<EtlStartDateRow>(
    `SELECT date::text AS start_date FROM (
       SELECT DISTINCT date FROM daily_prices
       WHERE date <= $1
       ORDER BY date DESC LIMIT $2
     ) sub ORDER BY date ASC LIMIT 1`,
    [targetDate, highLowDays],
  );
  return rows[0] ?? null;
}

/**
 * 배치 종목의 종가 이력을 조회한다 (build-stock-phases MA150 계산용).
 */
export async function findClosePricesForBatch(
  symbols: string[],
  targetDate: string,
): Promise<EtlCloseRow[]> {
  const { rows } = await pool.query<EtlCloseRow>(
    `SELECT symbol, date, close FROM daily_prices
     WHERE symbol = ANY($1) AND date <= $2
     ORDER BY symbol, date DESC`,
    [symbols, targetDate],
  );
  return rows;
}

/**
 * 배치 종목의 MA 데이터를 조회한다 (build-stock-phases 전용).
 */
export async function findMaDataForBatch(
  symbols: string[],
  targetDate: string,
): Promise<EtlMaRow[]> {
  const { rows } = await pool.query<EtlMaRow>(
    `SELECT symbol, ma50, ma200, vol_ma30 FROM daily_ma
     WHERE symbol = ANY($1) AND date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

/**
 * 배치 종목의 당일 거래량을 조회한다 (build-stock-phases 전용).
 */
export async function findVolumeForBatch(
  symbols: string[],
  targetDate: string,
): Promise<EtlVolumeRow[]> {
  const { rows } = await pool.query<EtlVolumeRow>(
    `SELECT symbol, volume::text FROM daily_prices
     WHERE symbol = ANY($1) AND date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

/**
 * 배치 종목의 최근 N거래일 거래량 이력을 조회한다 (VDU ratio 계산용).
 */
export async function findVolumeHistoryForBatch(
  symbols: string[],
  targetDate: string,
  days: number = 50,
): Promise<EtlVolumeHistoryRow[]> {
  const { rows } = await pool.query<EtlVolumeHistoryRow>(
    `SELECT symbol, date, volume::text
     FROM (
       SELECT symbol, date, volume,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
       FROM daily_prices
       WHERE symbol = ANY($1) AND date <= $2
     ) sub
     WHERE rn <= $3
     ORDER BY symbol, date DESC`,
    [symbols, targetDate, days],
  );
  return rows;
}

/**
 * 배치 종목의 당일 RS 스코어를 조회한다 (build-stock-phases 전용).
 */
export async function findRsScoresForBatch(
  symbols: string[],
  targetDate: string,
): Promise<EtlRsScoreRow[]> {
  const { rows } = await pool.query<EtlRsScoreRow>(
    `SELECT symbol, rs_score FROM daily_prices
     WHERE symbol = ANY($1) AND date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

/**
 * 배치 종목의 52주 고가/저가를 조회한다 (build-stock-phases 전용).
 */
export async function findHighLowForBatch(
  symbols: string[],
  highLowStartDate: string,
  targetDate: string,
): Promise<EtlHighLowRow[]> {
  const { rows } = await pool.query<EtlHighLowRow>(
    `SELECT symbol, MAX(high)::text AS high_52w, MIN(low)::text AS low_52w
     FROM daily_prices
     WHERE symbol = ANY($1)
       AND date > $2
       AND date <= $3
     GROUP BY symbol`,
    [symbols, highLowStartDate, targetDate],
  );
  return rows;
}

/**
 * 배치 종목의 직전 거래일 Phase + volume_confirmed를 조회한다 (build-stock-phases 전용).
 */
export async function findPrevPhasesForBatch(
  symbols: string[],
  targetDate: string,
): Promise<EtlPrevPhaseRow[]> {
  const { rows } = await pool.query<EtlPrevPhaseRow>(
    `SELECT symbol, phase, volume_confirmed FROM stock_phases
     WHERE symbol = ANY($1)
       AND date = (SELECT MAX(date) FROM stock_phases WHERE date < $2)`,
    [symbols, targetDate],
  );
  return rows;
}

// ─── ETL: validate-data 전용 ──────────────────────────────────────────────────

/**
 * 날짜별 Phase 분포(Phase + 건수)를 조회한다 (validate-data 전용).
 */
export async function findPhaseCountsByDate(
  date: string,
): Promise<EtlPhaseCountRow[]> {
  const { rows } = await pool.query<EtlPhaseCountRow>(
    `SELECT phase, COUNT(*) as cnt
     FROM stock_phases WHERE date = $1
     GROUP BY phase ORDER BY phase`,
    [date],
  );
  return rows;
}

/**
 * 날짜별 섹터 RS 행 수를 조회한다 (validate-data 전용).
 */
export async function countSectorRsByDate(
  date: string,
): Promise<EtlSectorCountRow> {
  const { rows } = await pool.query<EtlSectorCountRow>(
    `SELECT COUNT(*) as cnt FROM sector_rs_daily WHERE date = $1`,
    [date],
  );
  return rows[0] ?? { cnt: "0" };
}

/**
 * 날짜별 산업 RS 행 수를 조회한다 (validate-data 전용).
 */
export async function countIndustryRsByDate(
  date: string,
): Promise<EtlSectorCountRow> {
  const { rows } = await pool.query<EtlSectorCountRow>(
    `SELECT COUNT(*) as cnt FROM industry_rs_daily WHERE date = $1`,
    [date],
  );
  return rows[0] ?? { cnt: "0" };
}

/**
 * 섹터 RS 브레드스 범위를 검증한다 (validate-data 전용).
 */
export async function findBreadthCheckByDate(
  date: string,
): Promise<EtlBreadthCheckRow | null> {
  const { rows } = await pool.query<EtlBreadthCheckRow>(
    `SELECT
      MIN(phase2_ratio::numeric) as min_p2,
      MAX(phase2_ratio::numeric) as max_p2,
      MIN(rs_above50_ratio::numeric) as min_rs50,
      MAX(rs_above50_ratio::numeric) as max_rs50
     FROM sector_rs_daily WHERE date = $1`,
    [date],
  );
  return rows[0] ?? null;
}

/**
 * industry 미설정 활성 종목 수를 조회한다 (validate-data 전용).
 */
export async function countNullIndustrySymbols(): Promise<EtlNullIndustryRow> {
  const { rows } = await pool.query<EtlNullIndustryRow>(
    `SELECT COUNT(*) as cnt FROM symbols
     WHERE is_actively_trading = true AND is_etf = false AND is_fund = false
       AND industry != 'Shell Companies'
       AND (industry IS NULL OR industry = '')`,
  );
  return rows[0] ?? { cnt: "0" };
}

/**
 * 상위 3개 섹터 RS를 조회한다 (validate-data 전용).
 */
export async function findTopSectorsByDate(
  date: string,
  limit: number,
): Promise<EtlTopSectorRow[]> {
  const { rows } = await pool.query<EtlTopSectorRow>(
    `SELECT sector, avg_rs::numeric as avg_rs, rs_rank, phase2_ratio::numeric as p2
     FROM sector_rs_daily WHERE date = $1
     ORDER BY rs_rank LIMIT $2`,
    [date, limit],
  );
  return rows;
}

/**
 * 알려진 종목들의 Phase/RS를 조회한다 (validate-data 전용).
 */
export async function findKnownStocksByDate(
  date: string,
  symbols: string[],
): Promise<EtlKnownStockRow[]> {
  const { rows } = await pool.query<EtlKnownStockRow>(
    `SELECT symbol, phase, rs_score FROM stock_phases
     WHERE date = $1 AND symbol = ANY($2)
     ORDER BY symbol`,
    [date, symbols],
  );
  return rows;
}

// ─── ETL: record-new-signals 전용 ────────────────────────────────────────────

/**
 * Phase 1→2 전환 시그널을 조회한다 (record-new-signals 전용).
 */
export async function findPhase1to2Transitions(
  targetDate: string,
): Promise<EtlSignalTransitionRow[]> {
  const { rows } = await pool.query<EtlSignalTransitionRow>(
    `SELECT
       sp.symbol,
       dp.close::text,
       sp.rs_score,
       sp.volume_confirmed,
       srd.group_phase AS sector_group_phase,
       sym.sector,
       sym.industry
     FROM stock_phases sp
     JOIN daily_prices dp ON sp.symbol = dp.symbol AND sp.date = dp.date
     JOIN symbols sym ON sp.symbol = sym.symbol
     LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = sym.sector
     WHERE sp.date = $1
       AND sp.phase = 2
       AND sp.prev_phase IS DISTINCT FROM 2
       AND sym.market_cap::numeric >= $2`,
    [targetDate, MIN_MARKET_CAP],
  );
  return rows;
}

/**
 * 이미 기록된 시그널을 조회한다 (record-new-signals 전용).
 */
export async function findExistingSignals(
  symbols: string[],
  targetDate: string,
): Promise<EtlExistingSignalRow[]> {
  const { rows } = await pool.query<EtlExistingSignalRow>(
    `SELECT symbol FROM signal_log
     WHERE symbol = ANY($1) AND entry_date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

// ─── ETL: update-signal-returns 전용 ─────────────────────────────────────────

/**
 * 현재 종가 + Phase를 조회한다 (update-signal-returns 전용).
 */
export async function findCurrentPriceAndPhase(
  symbols: string[],
  targetDate: string,
): Promise<EtlCurrentDataRow[]> {
  const { rows } = await pool.query<EtlCurrentDataRow>(
    `SELECT p.symbol, p.close::text, sp.phase
     FROM daily_prices p
     LEFT JOIN stock_phases sp ON p.symbol = sp.symbol AND p.date = sp.date
     WHERE p.symbol = ANY($1) AND p.date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

/**
 * 진입일 ~ targetDate 사이 거래일 수를 일괄 조회한다 (update-signal-returns 전용).
 */
export async function findTradingDaysBetween(
  entryDates: string[],
  targetDate: string,
): Promise<EtlTradingDaysRow[]> {
  const { rows } = await pool.query<EtlTradingDaysRow>(
    `SELECT
       ed.entry_date,
       COALESCE(COUNT(DISTINCT dp.date), 0)::text AS trading_days
     FROM (SELECT unnest($1::text[]) AS entry_date) ed
     LEFT JOIN daily_prices dp
       ON dp.date > ed.entry_date
       AND dp.date <= $2
       AND dp.symbol = (SELECT symbol FROM daily_prices WHERE date = $2 LIMIT 1)
     GROUP BY ed.entry_date`,
    [entryDates, targetDate],
  );
  return rows;
}

// ─── ETL: track-phase-exits 전용 ─────────────────────────────────────────────

/**
 * 현재 Phase와 진입일 이후 저가를 조회한다 (track-phase-exits 전용).
 */
export async function findPhaseAndLowSinceEntry(
  symbols: string[],
  targetDate: string,
): Promise<EtlPhaseExitRow[]> {
  const { rows } = await pool.query<EtlPhaseExitRow>(
    `SELECT
       sp.symbol,
       sp.phase,
       (
         SELECT MIN(dp.low)::text
         FROM daily_prices dp
         WHERE dp.symbol = sp.symbol
           AND dp.date >= ANY(
             SELECT sl.entry_date FROM signal_log sl
             WHERE sl.symbol = sp.symbol AND sl.phase2_reverted IS NULL AND sl.status = 'ACTIVE'
             LIMIT 1
           )
           AND dp.date <= $2
       ) AS low_since_entry
     FROM stock_phases sp
     WHERE sp.symbol = ANY($1) AND sp.date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

// ─── ETL: update-recommendation-status 전용 ──────────────────────────────────

/**
 * 현재 종가 + Phase + RS를 조회한다 (update-recommendation-status 전용).
 */
export async function findRecommendationCurrentData(
  symbols: string[],
  targetDate: string,
): Promise<EtlRecommendationDataRow[]> {
  const { rows } = await pool.query<EtlRecommendationDataRow>(
    `SELECT p.symbol, p.close::text, sp.phase, sp.rs_score
     FROM daily_prices p
     LEFT JOIN stock_phases sp ON p.symbol = sp.symbol AND p.date = sp.date
     WHERE p.symbol = ANY($1) AND p.date = $2`,
    [symbols, targetDate],
  );
  return rows;
}

// ─── Agent QA (dailyQA, debateQA) 전용 ───────────────────────────────────────

/**
 * 지정 날짜의 상위 N개 섹터 RS를 조회한다 (dailyQA 전용).
 */
export async function findTopSectorsForQa(
  date: string,
  limit: number,
): Promise<QaTopSectorRow[]> {
  const { rows } = await pool.query<QaTopSectorRow>(
    `SELECT sector, avg_rs::text
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC
     LIMIT $2`,
    [date, limit],
  );
  return rows;
}

/**
 * 지정 날짜의 Phase 2 비율을 조회한다 (dailyQA 전용).
 * is_actively_trading + is_etf + is_fund 필터 포함.
 */
export async function findPhase2RatioForQa(
  date: string,
): Promise<QaPhase2RatioRow | null> {
  const { rows } = await pool.query<QaPhase2RatioRow>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE sp.phase = 2)::text AS phase2_count
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false
       AND s.industry != 'Shell Companies'`,
    [date],
  );
  return rows[0] ?? null;
}

/**
 * 지정 날짜 + 종목 목록의 Phase/RS를 조회한다 (dailyQA, debateQA 공용).
 */
export async function findStockPhasesForQa(
  date: string,
  symbols: string[],
): Promise<QaStockPhaseRow[]> {
  if (symbols.length === 0) return [];
  const { rows } = await pool.query<QaStockPhaseRow>(
    `SELECT symbol, phase, rs_score
     FROM stock_phases
     WHERE date = $1 AND symbol = ANY($2)`,
    [date, symbols],
  );
  return rows;
}

/**
 * 지정 날짜의 섹터 Phase를 조회한다 (debateQA 전용).
 */
export async function findSectorPhasesForQa(
  date: string,
): Promise<QaSectorPhaseRow[]> {
  const { rows } = await pool.query<QaSectorPhaseRow>(
    `SELECT sector, group_phase
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs DESC`,
    [date],
  );
  return rows;
}

// ─── sectorLagStats 전용 ─────────────────────────────────────────────────────

/**
 * 현재 Phase 2인 섹터를 조회한다 (sectorLagStats 전용).
 */
export async function findCurrentPhase2Sectors(): Promise<LagStatsSectorPhase2Row[]> {
  const { rows } = await pool.query<LagStatsSectorPhase2Row>(
    `SELECT DISTINCT sector AS entity_name FROM sector_rs_daily
     WHERE date = (SELECT MAX(date) FROM sector_rs_daily)
       AND group_phase = 2`,
  );
  return rows;
}

/**
 * 현재 Phase 2인 산업을 조회한다 (sectorLagStats 전용).
 */
export async function findCurrentPhase2Industries(): Promise<LagStatsIndustryPhase2Row[]> {
  const { rows } = await pool.query<LagStatsIndustryPhase2Row>(
    `SELECT DISTINCT industry AS entity_name FROM industry_rs_daily
     WHERE date = (SELECT MAX(date) FROM industry_rs_daily)
       AND group_phase = 2`,
  );
  return rows;
}

// ─── crossReportValidator 전용 ────────────────────────────────────────────────

/**
 * 지정 날짜의 일간 리포트에서 reported_symbols를 조회한다 (crossReportValidator 전용).
 */
export async function findDailyReportedSymbols(
  date: string,
): Promise<CrossReportDailyRow[]> {
  const { rows } = await pool.query<CrossReportDailyRow>(
    `SELECT reported_symbols
     FROM daily_reports
     WHERE report_date = $1
       AND type = 'daily'
     LIMIT 1`,
    [date],
  );
  return rows;
}

/**
 * 지정 날짜 범위의 thesis beneficiary_tickers를 조회한다 (crossReportValidator 전용).
 */
export async function findThesisBeneficiaryTickers(
  date: string,
): Promise<CrossReportThesisRow[]> {
  const { rows } = await pool.query<CrossReportThesisRow>(
    `SELECT debate_date, beneficiary_tickers
     FROM theses
     WHERE debate_date >= ($1::date - INTERVAL '2 days')::text
       AND debate_date <= $1::text
       AND status = 'ACTIVE'
     ORDER BY debate_date DESC`,
    [date],
  );
  return rows;
}

// ─── saveReportLog 전용 ───────────────────────────────────────────────────────

/**
 * 지정 날짜의 Phase 2 총 건수와 비율을 조회한다 (saveReportLog 전용).
 */
export async function findPhase2CountForReport(
  date: string,
): Promise<ReportLogPhase2CountRow | null> {
  const { rows } = await pool.query<ReportLogPhase2CountRow>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE phase = 2)::text AS phase2_count
     FROM stock_phases WHERE date = $1`,
    [date],
  );
  return rows[0] ?? null;
}

// ─── run-weekly-qa 전용 ───────────────────────────────────────────────────────

export type { WeeklyQaThesisWeeklyRow, WeeklyQaThesisOverallRow, WeeklyQaRecommendationRow, WeeklyQaLearningRow, WeeklyQaReportLogRow, WeeklyQaVerificationMethodRow, WeeklyQaBiasMetricsRow } from "./types.js";

/**
 * run-weekly-qa 전용: graceful degradation 래퍼와 함께 사용되는 raw SQL 쿼리들을 Pool을 통해 실행한다.
 * run-weekly-qa는 queryOrNull 패턴 사용 — pool을 인자로 받는다.
 */
export async function queryWeeklyQaThesisWeekly(pool: Pool): Promise<WeeklyQaThesisWeeklyRow[]> {
  const { rows } = await pool.query<WeeklyQaThesisWeeklyRow>(
    `SELECT agent_persona, status, COUNT(*)::int as cnt
     FROM theses
     WHERE created_at > NOW() - INTERVAL '7 days'
     GROUP BY agent_persona, status
     ORDER BY agent_persona, status`,
  );
  return rows;
}

export async function queryWeeklyQaThesisOverall(pool: Pool): Promise<WeeklyQaThesisOverallRow[]> {
  const { rows } = await pool.query<WeeklyQaThesisOverallRow>(
    `SELECT agent_persona,
       COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int as confirmed,
       COUNT(*) FILTER (WHERE status = 'INVALIDATED')::int as invalidated,
       COUNT(*) FILTER (WHERE status = 'EXPIRED')::int as expired,
       COUNT(*) FILTER (WHERE status = 'ACTIVE')::int as active,
       COUNT(*)::int as total
     FROM theses
     GROUP BY agent_persona
     ORDER BY agent_persona`,
  );
  return rows;
}

export async function queryWeeklyQaRecommendations(pool: Pool): Promise<WeeklyQaRecommendationRow[]> {
  const { rows } = await pool.query<WeeklyQaRecommendationRow>(
    `SELECT status,
       COUNT(*)::int as cnt,
       ROUND(AVG(pnl_percent)::numeric, 2)::float as avg_return
     FROM recommendations
     GROUP BY status
     ORDER BY status`,
  );
  return rows;
}

export async function queryWeeklyQaLearnings(pool: Pool): Promise<WeeklyQaLearningRow[]> {
  const { rows } = await pool.query<WeeklyQaLearningRow>(
    `SELECT category, COUNT(*)::int as cnt
     FROM agent_learnings
     WHERE is_active = true
     GROUP BY category
     ORDER BY category`,
  );
  return rows;
}

export async function queryWeeklyQaRecentReports(pool: Pool): Promise<WeeklyQaReportLogRow[]> {
  const { rows } = await pool.query<WeeklyQaReportLogRow>(
    `SELECT report_date, type
     FROM daily_reports
     WHERE report_date::date > (NOW() - INTERVAL '7 days')::date
     ORDER BY report_date DESC`,
  );
  return rows;
}

export async function queryWeeklyQaVerificationMethods(pool: Pool): Promise<WeeklyQaVerificationMethodRow[]> {
  const { rows } = await pool.query<WeeklyQaVerificationMethodRow>(
    `SELECT verification_method, status, COUNT(*)::int as cnt
     FROM theses
     WHERE status IN ('CONFIRMED', 'INVALIDATED')
     GROUP BY verification_method, status
     ORDER BY verification_method, status`,
  );
  return rows;
}

export async function queryWeeklyQaBiasMetrics(pool: Pool): Promise<WeeklyQaBiasMetricsRow[]> {
  const { rows } = await pool.query<WeeklyQaBiasMetricsRow>(
    `SELECT verification_path, COUNT(*)::int as cnt
     FROM agent_learnings
     WHERE is_active = true
     GROUP BY verification_path
     ORDER BY verification_path`,
  );
  return rows;
}

export interface WeeklyQaUpsertInput {
  qaDate: string;
  score: number | null;
  fullReport: string;
  ceoSummary: string | null;
  needsDecision: boolean;
  tokensInput: number;
  tokensOutput: number;
}

/**
 * 주간 QA 리포트를 weekly_qa_reports 테이블에 upsert한다.
 */
export async function upsertWeeklyQaReport(
  input: WeeklyQaUpsertInput,
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
): Promise<void> {
  const { qaDate, score, fullReport, ceoSummary, needsDecision, tokensInput, tokensOutput } = input;

  await pool.query(
    `INSERT INTO weekly_qa_reports
       (qa_date, score, full_report, ceo_summary, needs_decision, tokens_input, tokens_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (qa_date) DO UPDATE SET
       score = EXCLUDED.score,
       full_report = EXCLUDED.full_report,
       ceo_summary = EXCLUDED.ceo_summary,
       needs_decision = EXCLUDED.needs_decision,
       tokens_input = EXCLUDED.tokens_input,
       tokens_output = EXCLUDED.tokens_output`,
    [qaDate, score, fullReport, ceoSummary, needsDecision, tokensInput, tokensOutput],
  );
}
