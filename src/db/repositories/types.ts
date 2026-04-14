/**
 * DB Repository 공용 Row 타입 정의.
 * 각 Repository 함수의 반환 타입에 사용된다.
 */

// ─── stock_phases ─────────────────────────────────────────────────────────────

export interface StockPhaseRow {
  symbol: string;
  phase: number;
  prev_phase: number | null;
  rs_score: number;
  ma150_slope: string | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
  vol_ratio: string | null;
  volume_confirmed: boolean | null;
  breakout_signal: string | null;
  sector: string | null;
  industry: string | null;
  sepa_grade: string | null;
}

export interface UnusualPhaseCountRow {
  cnt: string;
}

// ─── sector_rs_daily ──────────────────────────────────────────────────────────

export interface SectorRsRow {
  sector: string;
  avg_rs: string;
  rs_rank: number;
  stock_count: number;
  change_4w: string | null;
  change_8w: string | null;
  change_12w: string | null;
  group_phase: number;
  prev_group_phase: number | null;
  phase2_ratio: string;
  ma_ordered_ratio: string;
  phase1to2_count_5d: number;
}

export interface SectorRsCompactRow {
  sector: string;
  avg_rs: string;
  rs_rank: number;
}

export interface SectorPhaseTransitionRow {
  sector: string;
}

export interface SectorRsNewEntrantRow {
  sector: string;
  is_new: boolean;
}

export interface SectorPhase1to2SurgeRow {
  total: string;
}

// ─── industry_rs_daily ────────────────────────────────────────────────────────

export interface IndustryRsRow {
  sector: string;
  industry: string;
  avg_rs: string;
  rs_rank: number;
  group_phase: number;
  phase2_ratio: string;
}

/**
 * 섹터 필터 없는 전체 업종 RS 랭킹 조회 결과 (mode: 'industry' 전용).
 * sector_rs_daily와 LEFT JOIN하여 소속 섹터 RS 정보를 함께 반환한다.
 */
export interface IndustryRsGlobalRow {
  date: string;
  sector: string;
  industry: string;
  avg_rs: string;
  rs_rank: number;
  group_phase: number;
  phase2_ratio: string;
  change_4w: string | null;
  change_8w: string | null;
  change_12w: string | null;
  sector_avg_rs: string | null;
  sector_rs_rank: number | null;
}

/**
 * 섹터 Phase 전환 시 업종 드릴다운 조회 결과.
 * 현재일 + 전일 LEFT JOIN으로 RS 변화를 계산한다.
 */
export interface IndustryDrilldownRow {
  sector: string;
  industry: string;
  avg_rs: string;
  group_phase: number;
  prev_group_phase: number | null;
  rs_change: string | null;
}

/**
 * 업종 RS 주간 변화 조회 결과 (mode: 'industry' 전주 대비 변화용).
 * 현재 주 RS - 전주 RS = change_week
 */
export interface IndustryWeeklyChangeRow {
  sector: string;
  industry: string;
  avg_rs: string;
  rs_rank: number;
  group_phase: number;
  phase2_ratio: string;
  change_week: string | null;
}

// ─── market_regimes ──────────────────────────────────────────────────────────

export interface MarketRegimeRow {
  regime: string;
}

// ─── fundamental_scores + company_profiles ───────────────────────────────────

export interface SectorSepaStatsRow {
  industry: string;
  total_stocks: string;
  sa_grade_count: string;
  avg_score: string;
}

// ─── 전주 날짜 조회 ───────────────────────────────────────────────────────────

export interface PrevWeekDateRow {
  prev_week_date: string | null;
}

export interface PrevDayDateRow {
  prev_day_date: string | null;
}

// ─── marketBreadthRepository ──────────────────────────────────────────────────

export interface TradingDateRow {
  date: string;
}

export interface WeeklyTrendRow {
  date: string;
  total: string;
  phase2_count: string;
  avg_rs: string;
}

export interface Phase1to2TransitionsRow {
  transitions: string;
}

export interface PhaseTransitionCount1dRow {
  count: string;
}

export interface PhaseDistributionRow {
  phase: number;
  count: string;
}

export interface PrevPhase2RatioRow {
  phase2_count: string;
  total_count: string;
}

export interface MarketAvgRsRow {
  avg_rs: string;
}

export interface AdvanceDeclineRow {
  advancers: string;
  decliners: string;
  unchanged: string;
}

export interface NewHighLowRow {
  new_highs: string;
  new_lows: string;
}

export interface BreadthTopSectorRow {
  sector: string;
  avg_rs: string;
  group_phase: number;
}

// marketDataLoader.ts 버전 (symbols 필터 없음)

export interface MarketBreadthPhaseDistributionRow {
  phase: number;
  count: string;
}

export interface MarketBreadthPrevPhase2Row {
  phase2_count: string;
  total_count: string;
}

export interface MarketBreadthAvgRsRow {
  avg_rs: string;
}

export interface MarketBreadthAdRow {
  advancers: string;
  decliners: string;
}

export interface MarketBreadthHlRow {
  new_highs: string;
  new_lows: string;
}

export interface SectorSnapshotRow {
  sector: string;
  avg_rs: string;
  rs_rank: number;
  group_phase: number;
  prev_group_phase: number | null;
  change_4w: string | null;
  change_12w: string | null;
  phase2_ratio: string;
  phase1to2_count_5d: number;
}

export interface Phase2StockRow {
  symbol: string;
  rs_score: number;
  prev_phase: number | null;
  sector: string | null;
  industry: string | null;
  volume_confirmed: boolean | null;
  breakout_signal: string | null;
  pct_from_high_52w: string | null;
  market_cap: string | null;
  price_change_5d: string | null;
  price_change_20d: string | null;
}

export interface DataDateRow {
  date: string | null;
}

// ─── market_breadth_daily ─────────────────────────────────────────────────────

export interface MarketBreadthDailyRow {
  date: string;
  total_stocks: number;
  phase1_count: number;
  phase2_count: number;
  phase3_count: number;
  phase4_count: number;
  phase2_ratio: string;
  phase2_ratio_change: string | null;
  phase1_to2_count_5d: number | null;
  phase1_to2_count_1d: number | null;
  phase2_to3_count_1d: number | null;
  market_avg_rs: string | null;
  advancers: number | null;
  decliners: number | null;
  unchanged: number | null;
  ad_ratio: string | null;
  new_highs: number | null;
  new_lows: number | null;
  hl_ratio: string | null;
  vix_close: string | null;
  vix_high: string | null;
  fear_greed_score: number | null;
  fear_greed_rating: string | null;
  breadth_score: string | null;
  divergence_signal: string | null;
  created_at: string;
}

export interface PrevBreadthScoreRow {
  breadth_score: string | null;
}

export interface PrevPhase2CountRow {
  /** integer 컬럼 — pg driver가 number로 반환. numeric 컬럼(string)과 달리 변환 불필요. */
  phase2_count: number | null;
}

// ─── priceRepository ─────────────────────────────────────────────────────────

export interface PriceRow {
  symbol: string;
  close: string | null;
  prev_close: string | null;
  volume: string | null;
  vol_ma30: string | null;
}

// ─── groupRsRepository ───────────────────────────────────────────────────────

export interface GroupAvgRow {
  group_name: string;
  parent_group: string | null;
  avg_rs: string;
  stock_count: string;
}

export interface GroupHistoricalRsRow {
  group_name: string;
  date: string;
  avg_rs: string;
  row_num: string;
}

export interface GroupBreadthRow {
  group_name: string;
  ma_ordered_ratio: string;
  phase2_ratio: string;
  rs_above50_ratio: string;
  new_high_ratio: string;
}

export interface GroupTransitionRow {
  group_name: string;
  p1to2: string;
  p2to3: string;
}

export interface GroupFundamentalRow {
  group_name: string;
  revenue_accel_ratio: string;
  income_accel_ratio: string;
  profitable_ratio: string;
}

export interface GroupPrevPhaseRow {
  group_name: string;
  group_phase: number;
}

// ─── stockPhaseRepository (Phase2 검사) ───────────────────────────────────────

export interface Phase2PersistenceRow {
  symbol: string;
  phase2_count: string;
}

export interface Phase2StabilityRow {
  symbol: string;
}

// ─── symbolRepository ─────────────────────────────────────────────────────────

export interface SymbolMetaRow {
  sector: string | null;
  industry: string | null;
  market_cap: string | null;
}

// ─── fundamentalRepository ────────────────────────────────────────────────────

export interface FundamentalGradeRow {
  grade: string;
}

export interface FundamentalAccelerationRow {
  symbol: string;
  period_end_date: string;
  eps_diluted: string | null;
  revenue: string | null;
  net_income: string | null;
  sector: string | null;
  industry: string | null;
}

// ─── stockPhaseRepository (Phase 3 추가) ──────────────────────────────────────

export interface StockPhaseDetailRow {
  rs_score: number | null;
  phase: number;
  ma150_slope: string | null;
  vol_ratio: string | null;
  volume_confirmed: boolean | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
}

export interface StockPhaseFullRow {
  phase: number;
  prev_phase: number | null;
  rs_score: number;
  ma150: string | null;
  ma150_slope: string | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
}

export interface MarketPhase2RatioRow {
  phase2_ratio: string | null;
}

export interface Phase2PersistenceBySymbolRow {
  phase2_count: string;
}

export interface Phase2SinceRow {
  symbol: string;
  phase2_since: string;
}

export interface UnusualStockRow {
  symbol: string;
  close: string;
  prev_close: string;
  daily_return: string;
  volume: string;
  vol_ma30: string;
  vol_ratio: string;
  phase: number;
  prev_phase: number | null;
  rs_score: number;
  sector: string;
  industry: string;
  company_name: string;
}

export interface RisingRsStockRow {
  symbol: string;
  phase: number;
  rs_score: number;
  rs_score_4w_ago: number | null;
  rs_change: number | null;
  ma150_slope: string | null;
  pct_from_low_52w: string | null;
  vol_ratio: string | null;
  sector: string | null;
  industry: string | null;
  sector_avg_rs: string | null;
  sector_change_4w: string | null;
  sector_group_phase: number | null;
  sepa_grade: string | null;
  market_cap: string | null;
}

export interface Phase1LateStockRow {
  symbol: string;
  phase: number;
  prev_phase: number | null;
  rs_score: number;
  ma150_slope: string | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
  vol_ratio: string | null;
  vdu_ratio: string | null;
  sector: string | null;
  industry: string | null;
  sector_group_phase: number | null;
  sector_avg_rs: string | null;
  sepa_grade: string | null;
}

export interface EtlVolumeHistoryRow {
  symbol: string;
  date: string;
  volume: string | null;
}

// ─── sectorRepository (Phase 3 추가) ──────────────────────────────────────────

export interface SectorRsContextRow {
  avg_rs: string | null;
  group_phase: number | null;
}

export interface SectorRsDetailContextRow {
  avg_rs: string;
  rs_rank: number;
  group_phase: number;
}

export interface SectorRsRankWithTotalRow {
  rs_rank: string;
  total_sectors: string;
}

export interface IndustryRsRankWithTotalRow {
  rs_rank: string;
  total_industries: string;
}

// ─── priceRepository (Phase 3 추가) ───────────────────────────────────────────

export interface PriceWithMaRow {
  close: string;
  volume: string;
  ma50: string | null;
  ma200: string | null;
}

export interface LatestCloseRow {
  symbol: string;
  close: string;
}

// ─── stock_news / earning_calendar ───────────────────────────────────────────

export interface CorporateStockNewsRow {
  title: string;
  site: string | null;
  published_date: string;
}

export interface CorporateEarningCalendarRow {
  date: string;
  eps_estimated: string | null;
  revenue_estimated: string | null;
  time: string | null;
}

// ─── corporateRepository ──────────────────────────────────────────────────────

export interface CorporateRecommendationFactorsRow {
  rs_score: number | null;
  phase: number | null;
  ma150_slope: string | null;
  vol_ratio: string | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
  volume_confirmed: boolean | null;
  sector_rs: string | null;
  sector_group_phase: number | null;
  industry_rs: string | null;
  industry_group_phase: number | null;
}

export interface CorporateSymbolRow {
  company_name: string | null;
  sector: string | null;
  industry: string | null;
}

export interface CorporateFinancialsRow {
  period_end_date: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  ebitda: string | null;
  free_cash_flow: string | null;
  gross_profit: string | null;
}

export interface CorporateRatiosRow {
  pe_ratio: string | null;
  ps_ratio: string | null;
  pb_ratio: string | null;
  ev_ebitda: string | null;
  gross_margin: string | null;
  op_margin: string | null;
  net_margin: string | null;
  debt_equity: string | null;
}

export interface CorporateMarketRegimeRow {
  regime: string;
  rationale: string;
  confidence: string;
}

export interface CorporateDebateSessionRow {
  synthesis_report: string;
}

export interface CorporateCompanyProfileRow {
  description: string | null;
  ceo: string | null;
  employees: number | null;
  market_cap: string | null;
  website: string | null;
  country: string | null;
  exchange: string | null;
  ipo_date: string | null;
}

export interface CorporateAnnualFinancialsRow {
  fiscal_year: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  gross_profit: string | null;
  operating_income: string | null;
  ebitda: string | null;
  free_cash_flow: string | null;
}

export interface CorporateEarningCallTranscriptRow {
  quarter: number;
  year: number;
  date: string | null;
  transcript: string | null;
}

export interface CorporateAnalystEstimatesRow {
  period: string;
  estimated_eps_avg: string | null;
  estimated_eps_high: string | null;
  estimated_eps_low: string | null;
  estimated_revenue_avg: string | null;
  number_analyst_estimated_eps: number | null;
}

export interface CorporateEpsSurprisesRow {
  actual_date: string;
  actual_eps: string | null;
  estimated_eps: string | null;
}

export interface CorporatePeerGroupRow {
  peers: string[] | null;
}

export interface CorporatePeerRatiosRow {
  symbol: string;
  pe_ratio: string | null;
  ev_ebitda: string | null;
  ps_ratio: string | null;
}

export interface CorporatePriceTargetConsensusRow {
  target_high: string | null;
  target_low: string | null;
  target_mean: string | null;
  target_median: string | null;
}

export interface CorporateStockPhasesCloseRow {
  close: string;
}

export interface CorporateSectorRsRow {
  avg_rs: string | null;
  group_phase: number | null;
  change_4w: string | null;
  change_8w: string | null;
}

export interface CorporateIndustryRsRow {
  avg_rs: string | null;
  group_phase: number | null;
}

export interface CorporateActiveTrackedRow {
  symbol: string;
  entry_date: string;
}

export interface CorporateAnalysisReportRow {
  symbol: string;
  recommendation_date: string;
}

// ─── ETL + Agent (Phase 4 추가) ───────────────────────────────────────────────

export interface EtlSymbolRow {
  symbol: string;
  sector: string | null;
  industry: string | null;
}

export interface EtlStartDateRow {
  start_date: string;
}

export interface EtlCloseRow {
  symbol: string;
  date: string;
  close: string | null;
}

export interface EtlMaRow {
  symbol: string;
  ma50: string | null;
  ma200: string | null;
  vol_ma30: string | null;
}

export interface EtlVolumeRow {
  symbol: string;
  volume: string | null;
}

export interface EtlRsScoreRow {
  symbol: string;
  rs_score: number | null;
}

export interface EtlHighLowRow {
  symbol: string;
  high_52w: string;
  low_52w: string;
}

export interface EtlPrevPhaseRow {
  symbol: string;
  phase: number;
  volume_confirmed: boolean | null;
}

export interface EtlSectorPhaseTransitionRow {
  date: string;
  entity_name: string;
  from_phase: number;
  to_phase: number;
  avg_rs: string | null;
  phase2_ratio: string | null;
}

export interface EtlPhaseCountRow {
  phase: number;
  cnt: string;
}

export interface EtlSectorCountRow {
  cnt: string;
}

export interface EtlBreadthCheckRow {
  min_p2: string | null;
  max_p2: string | null;
  min_rs50: string | null;
  max_rs50: string | null;
}

export interface EtlNullIndustryRow {
  cnt: string;
}

export interface EtlTopSectorRow {
  sector: string;
  avg_rs: string;
  rs_rank: number;
  p2: string;
}

export interface EtlKnownStockRow {
  symbol: string;
  phase: number;
  rs_score: number;
}

export interface EtlSignalTransitionRow {
  symbol: string;
  close: string;
  rs_score: number | null;
  volume_confirmed: boolean | null;
  sector_group_phase: number | null;
  sector: string | null;
  industry: string | null;
}

export interface EtlExistingSignalRow {
  symbol: string;
}

export interface EtlCurrentDataRow {
  symbol: string;
  close: string;
  phase: number | null;
}

export interface EtlTradingDaysRow {
  entry_date: string;
  trading_days: string;
}

export interface EtlPhaseExitRow {
  symbol: string;
  phase: number | null;
  low_since_entry: string | null;
}

// ─── Agent QA (Phase 4 추가) ──────────────────────────────────────────────────

export interface QaTopSectorRow {
  sector: string;
  avg_rs: string;
}

export interface QaPhase2RatioRow {
  total: string;
  phase2_count: string;
}

export interface QaStockPhaseRow {
  symbol: string;
  phase: number;
  rs_score: number | null;
}

export interface QaSectorPhaseRow {
  sector: string;
  group_phase: number;
}

// ─── sectorLagStats (Phase 4 추가) ────────────────────────────────────────────

export interface LagStatsSectorPhase2Row {
  entity_name: string;
}

export interface LagStatsIndustryPhase2Row {
  entity_name: string;
}

// ─── crossReportValidator (Phase 4 추가) ──────────────────────────────────────

export interface CrossReportDailyRow {
  reported_symbols: unknown[];
}

export interface CrossReportThesisRow {
  debate_date: string;
  beneficiary_tickers: string | null;
}

// ─── saveReportLog (Phase 4 추가) ─────────────────────────────────────────────

export interface ReportLogPhase2CountRow {
  total: string;
  phase2_count: string;
}

// ─── run-weekly-qa (Phase 4 추가) ─────────────────────────────────────────────

export interface WeeklyQaThesisWeeklyRow {
  agent_persona: string;
  status: string;
  cnt: number;
}

export interface WeeklyQaThesisOverallRow {
  agent_persona: string;
  confirmed: number;
  invalidated: number;
  expired: number;
  active: number;
  total: number;
}

export interface WeeklyQaTrackedStockRow {
  status: string;
  cnt: number;
  avg_return: number | null;
}

export interface WeeklyQaLearningRow {
  category: string;
  cnt: number;
}

export interface WeeklyQaReportLogRow {
  report_date: string;
  type: string;
}

export interface WeeklyQaVerificationMethodRow {
  verification_method: string | null;
  status: string;
  cnt: number;
}

export interface WeeklyQaBiasMetricsRow {
  verification_path: string | null;
  cnt: number;
}

// ─── signalRepository (Phase 2 조기포착 신호) ──────────────────────────────

export interface VcpCandidateRow {
  symbol: string;
  date: string;
  bb_width_current: string | null;
  bb_width_avg_60d: string | null;
  atr14_percent: string | null;
  body_ratio: string | null;
  ma20_ma50_distance_percent: string | null;
  sector: string | null;
  industry: string | null;
  phase: number | null;
  rs_score: number | null;
}

export interface ConfirmedBreakoutRow {
  symbol: string;
  date: string;
  breakout_percent: string | null;
  volume_ratio: string | null;
  is_perfect_retest: boolean;
  ma20_distance_percent: string | null;
  sector: string | null;
  industry: string | null;
  phase: number | null;
  rs_score: number | null;
}

export interface SectorLagPatternRow {
  entity_type: string;
  leader_entity: string;
  follower_entity: string;
  transition: string;
  sample_count: number;
  avg_lag_days: string | null;
  median_lag_days: string | null;
  stddev_lag_days: string | null;
  p_value: string | null;
  last_observed_at: string | null;
  last_lag_days: number | null;
}

// ─── sectorClusterRepository ────────────────────────────────────────────────

export interface SectorClusterRow {
  sector: string;
  sector_avg_rs: string;
  phase2_ratio: string;
  group_phase: number;
  symbol: string | null;
  rs_score: number | null;
  industry: string | null;
}
