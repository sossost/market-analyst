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
  sector: string | null;
  industry: string | null;
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
  pct_from_high_52w: string | null;
  market_cap: string | null;
  price_change_5d: string | null;
  price_change_20d: string | null;
}

export interface DataDateRow {
  date: string | null;
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
