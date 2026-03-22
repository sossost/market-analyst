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
