/**
 * watchlist_stocks 테이블 조회/갱신 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

import { pool } from "@/db/client";

// ─── Row 타입 ─────────────────────────────────────────────────────────────────

export interface ActiveWatchlistRow {
  id: number;
  symbol: string;
  entry_date: string;
  entry_phase: number;
  entry_rs_score: number | null;
  entry_sector_rs: string | null;
  entry_sepa_grade: string | null;
  entry_thesis_id: number | null;
  entry_sector: string | null;
  entry_industry: string | null;
  entry_reason: string | null;
  tracking_end_date: string | null;
  current_phase: number | null;
  current_rs_score: number | null;
  phase_trajectory: Array<{ date: string; phase: number; rsScore: number | null }> | null;
  sector_relative_perf: string | null;
  price_at_entry: string | null;
  current_price: string | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  days_tracked: number;
  last_updated: string | null;
}

export interface WatchlistSymbolRow {
  id: number;
  symbol: string;
}

export interface WatchlistActiveBySymbolRow {
  id: number;
  symbol: string;
  entry_date: string;
}

// ─── 조회 함수 ────────────────────────────────────────────────────────────────

/**
 * ACTIVE 상태인 watchlist 전체를 조회한다.
 */
export async function findActiveWatchlist(): Promise<ActiveWatchlistRow[]> {
  const { rows } = await pool.query<ActiveWatchlistRow>(
    `SELECT
       id, symbol, entry_date, entry_phase, entry_rs_score,
       entry_sector_rs::text, entry_sepa_grade, entry_thesis_id,
       entry_sector, entry_industry, entry_reason,
       tracking_end_date, current_phase, current_rs_score,
       phase_trajectory, sector_relative_perf::text,
       price_at_entry::text, current_price::text,
       pnl_percent::text, max_pnl_percent::text,
       days_tracked, last_updated
     FROM watchlist_stocks
     WHERE status = 'ACTIVE'
     ORDER BY entry_date DESC`,
  );

  return rows;
}

/**
 * ACTIVE 상태인 watchlist에서 지정 symbols의 중복 여부를 조회한다.
 */
export async function findActiveWatchlistBySymbols(
  symbols: string[],
): Promise<WatchlistActiveBySymbolRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<WatchlistActiveBySymbolRow>(
    `SELECT id, symbol, entry_date
     FROM watchlist_stocks
     WHERE status = 'ACTIVE' AND symbol = ANY($1)`,
    [symbols],
  );

  return rows;
}

/**
 * 지정 ID의 watchlist 항목을 조회한다.
 */
export async function findWatchlistById(
  id: number,
): Promise<ActiveWatchlistRow | null> {
  const { rows } = await pool.query<ActiveWatchlistRow>(
    `SELECT
       id, symbol, entry_date, entry_phase, entry_rs_score,
       entry_sector_rs::text, entry_sepa_grade, entry_thesis_id,
       entry_sector, entry_industry, entry_reason,
       tracking_end_date, current_phase, current_rs_score,
       phase_trajectory, sector_relative_perf::text,
       price_at_entry::text, current_price::text,
       pnl_percent::text, max_pnl_percent::text,
       days_tracked, last_updated
     FROM watchlist_stocks
     WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
}

// ─── 갱신 함수 ────────────────────────────────────────────────────────────────

export interface WatchlistTrackingUpdate {
  id: number;
  currentPhase: number;
  currentRsScore: number | null;
  phaseTrajectory: Array<{ date: string; phase: number; rsScore: number | null }>;
  sectorRelativePerf: number | null;
  currentPrice: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  daysTracked: number;
  lastUpdated: string;
}

/**
 * watchlist 항목의 트래킹 데이터를 갱신한다.
 */
export async function updateWatchlistTracking(
  update: WatchlistTrackingUpdate,
): Promise<void> {
  await pool.query(
    `UPDATE watchlist_stocks
     SET
       current_phase = $1,
       current_rs_score = $2,
       phase_trajectory = $3,
       sector_relative_perf = $4,
       current_price = $5,
       pnl_percent = $6,
       max_pnl_percent = $7,
       days_tracked = $8,
       last_updated = $9
     WHERE id = $10`,
    [
      update.currentPhase,
      update.currentRsScore,
      JSON.stringify(update.phaseTrajectory),
      update.sectorRelativePerf,
      update.currentPrice,
      update.pnlPercent,
      update.maxPnlPercent,
      update.daysTracked,
      update.lastUpdated,
      update.id,
    ],
  );
}

/**
 * watchlist 항목을 EXITED 상태로 전환한다.
 */
export async function exitWatchlistItem(
  id: number,
  exitDate: string,
  exitReason: string,
): Promise<void> {
  await pool.query(
    `UPDATE watchlist_stocks
     SET status = 'EXITED', exit_date = $1, exit_reason = $2
     WHERE id = $3`,
    [exitDate, exitReason, id],
  );
}
