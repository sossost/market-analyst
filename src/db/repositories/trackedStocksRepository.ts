/**
 * tracked_stocks 테이블 조회/갱신 Repository.
 * recommendations + watchlist_stocks 통합 레포지토리.
 * 재시도 로직은 호출부가 담당한다.
 */

import { pool } from "@/db/client";

// ─── Row 타입 ─────────────────────────────────────────────────────────────────

export type TrackedStockSource = "etl_auto" | "agent" | "thesis_aligned";
export type TrackedStockTier = "standard" | "featured";
export type TrackedStockStatus = "ACTIVE" | "EXPIRED" | "EXITED";

export interface TrackedStockRow {
  id: number;
  symbol: string;
  source: TrackedStockSource;
  tier: TrackedStockTier;
  entry_date: string;
  entry_price: string;
  entry_phase: number;
  entry_prev_phase: number | null;
  entry_rs_score: number | null;
  entry_sepa_grade: string | null;
  entry_thesis_id: number | null;
  entry_sector: string | null;
  entry_industry: string | null;
  entry_reason: string | null;
  status: TrackedStockStatus;
  market_regime: string | null;
  current_price: string | null;
  current_phase: number | null;
  current_rs_score: number | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  days_tracked: number;
  last_updated: string | null;
  return_7d: string | null;
  return_30d: string | null;
  return_90d: string | null;
  tracking_end_date: string | null;
  phase_trajectory: Array<{
    date: string;
    phase: number;
    rsScore: number | null;
  }> | null;
  sector_relative_perf: string | null;
  exit_date: string | null;
  exit_reason: string | null;
}

export interface TrackedStockSymbolRow {
  id: number;
  symbol: string;
}

export interface TrackedStockActiveBySymbolRow {
  id: number;
  symbol: string;
  entry_date: string;
}

// ─── INSERT 타입 ──────────────────────────────────────────────────────────────

export interface InsertTrackedStockInput {
  symbol: string;
  source: TrackedStockSource;
  tier: TrackedStockTier;
  entryDate: string;
  entryPrice: number;
  entryPhase: number;
  entryPrevPhase: number | null;
  entryRsScore: number | null;
  entrySepaGrade: string | null;
  entryThesisId: number | null;
  entrySector: string | null;
  entryIndustry: string | null;
  entryReason: string | null;
  marketRegime: string | null;
  trackingEndDate: string;
}

// ─── UPDATE 타입 ──────────────────────────────────────────────────────────────

export interface TrackedStockTrackingUpdate {
  id: number;
  currentPhase: number;
  currentRsScore: number | null;
  currentPrice: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  daysTracked: number;
  lastUpdated: string;
  phaseTrajectory: Array<{
    date: string;
    phase: number;
    rsScore: number | null;
  }>;
  sectorRelativePerf: number | null;
  return7d: number | null;
  return30d: number | null;
  return90d: number | null;
}

// ─── 공통 SELECT 컬럼 목록 ────────────────────────────────────────────────────

const SELECT_COLUMNS = `
  id, symbol, source, tier,
  entry_date, entry_price::text, entry_phase, entry_prev_phase,
  entry_rs_score, entry_sepa_grade, entry_thesis_id,
  entry_sector, entry_industry, entry_reason,
  status, market_regime,
  current_price::text, current_phase, current_rs_score,
  pnl_percent::text, max_pnl_percent::text,
  days_tracked, last_updated,
  return_7d::text, return_30d::text, return_90d::text,
  tracking_end_date, phase_trajectory,
  sector_relative_perf::text,
  exit_date, exit_reason
`;

// ─── 조회 함수 ────────────────────────────────────────────────────────────────

/**
 * ACTIVE 상태인 tracked_stocks 전체를 조회한다.
 */
export async function findActiveTrackedStocks(): Promise<TrackedStockRow[]> {
  const { rows } = await pool.query<TrackedStockRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM tracked_stocks
     WHERE status = 'ACTIVE'
     ORDER BY entry_date DESC`,
  );

  return rows;
}

/**
 * ACTIVE 상태인 tracked_stocks에서 지정 symbols의 중복 여부를 조회한다.
 */
export async function findActiveTrackedStocksBySymbols(
  symbols: string[],
): Promise<TrackedStockActiveBySymbolRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<TrackedStockActiveBySymbolRow>(
    `SELECT id, symbol, entry_date
     FROM tracked_stocks
     WHERE status = 'ACTIVE' AND symbol = ANY($1)`,
    [symbols],
  );

  return rows;
}

/**
 * 지정 ID의 tracked_stocks 항목을 조회한다.
 */
export async function findTrackedStockById(
  id: number,
): Promise<TrackedStockRow | null> {
  const { rows } = await pool.query<TrackedStockRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM tracked_stocks
     WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
}

/**
 * 최근 N일 내에 EXITED 또는 EXPIRED된 이력을 조회한다.
 * 쿨다운 체크용 — 해당 symbol이 쿨다운 기간 내에 있는지 확인한다.
 */
export async function findRecentTrackedBySymbol(
  symbol: string,
  days: number,
): Promise<TrackedStockActiveBySymbolRow[]> {
  const { rows } = await pool.query<TrackedStockActiveBySymbolRow>(
    `SELECT id, symbol, entry_date
     FROM tracked_stocks
     WHERE symbol = $1
       AND status <> 'ACTIVE'
       AND exit_date >= CURRENT_DATE - $2::integer * INTERVAL '1 day'`,
    [symbol, days],
  );

  return rows;
}

/**
 * 쿨다운 시작일 이후에 EXITED 또는 EXPIRED된 종목을 배치 조회한다.
 * scan-recommendation-candidates 쿨다운 게이트용.
 */
export async function findRecentlyExitedBySymbols(
  cooldownStart: string,
  symbols: string[],
): Promise<TrackedStockActiveBySymbolRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<TrackedStockActiveBySymbolRow>(
    `SELECT DISTINCT id, symbol, entry_date
     FROM tracked_stocks
     WHERE status <> 'ACTIVE'
       AND exit_date >= $1
       AND symbol = ANY($2)`,
    [cooldownStart, symbols],
  );

  return rows;
}

/**
 * source별 ACTIVE tracked_stocks를 조회한다.
 */
export async function findActiveTrackedStocksBySource(
  source: TrackedStockSource,
): Promise<TrackedStockRow[]> {
  const { rows } = await pool.query<TrackedStockRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM tracked_stocks
     WHERE status = 'ACTIVE' AND source = $1
     ORDER BY entry_date DESC`,
    [source],
  );

  return rows;
}

/**
 * tier별 ACTIVE tracked_stocks를 조회한다.
 */
export async function findActiveTrackedStocksByTier(
  tier: TrackedStockTier,
): Promise<TrackedStockRow[]> {
  const { rows } = await pool.query<TrackedStockRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM tracked_stocks
     WHERE status = 'ACTIVE' AND tier = $1
     ORDER BY entry_date DESC`,
    [tier],
  );

  return rows;
}

// ─── 삽입 함수 ────────────────────────────────────────────────────────────────

/**
 * 신규 tracked_stock을 등록한다.
 * UNIQUE(symbol, entry_date) 충돌 시 아무 작업도 하지 않는다.
 * 삽입된 경우 id를 반환하고, 충돌(중복)이면 null을 반환한다.
 */
export async function insertTrackedStock(
  data: InsertTrackedStockInput,
): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO tracked_stocks (
       symbol, source, tier,
       entry_date, entry_price, entry_phase, entry_prev_phase,
       entry_rs_score, entry_sepa_grade, entry_thesis_id,
       entry_sector, entry_industry, entry_reason,
       status, market_regime, tracking_end_date,
       days_tracked
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ACTIVE', $14, $15, 0)
     ON CONFLICT (symbol, entry_date) DO NOTHING
     RETURNING id`,
    [
      data.symbol,
      data.source,
      data.tier,
      data.entryDate,
      data.entryPrice,
      data.entryPhase,
      data.entryPrevPhase,
      data.entryRsScore,
      data.entrySepaGrade,
      data.entryThesisId,
      data.entrySector,
      data.entryIndustry,
      data.entryReason,
      data.marketRegime,
      data.trackingEndDate,
    ],
  );

  return rows[0]?.id ?? null;
}

// ─── 갱신 함수 ────────────────────────────────────────────────────────────────

/**
 * tracked_stock의 트래킹 데이터를 갱신한다.
 * 매일 ETL(update-tracked-stocks)이 호출한다.
 */
export async function updateTracking(
  update: TrackedStockTrackingUpdate,
): Promise<void> {
  await pool.query(
    `UPDATE tracked_stocks
     SET
       current_phase = $1,
       current_rs_score = $2,
       current_price = $3,
       pnl_percent = $4,
       max_pnl_percent = $5,
       days_tracked = $6,
       last_updated = $7,
       phase_trajectory = $8,
       sector_relative_perf = $9,
       return_7d = COALESCE(return_7d, $10),
       return_30d = COALESCE(return_30d, $11),
       return_90d = COALESCE(return_90d, $12)
     WHERE id = $13`,
    [
      update.currentPhase,
      update.currentRsScore,
      update.currentPrice,
      update.pnlPercent,
      update.maxPnlPercent,
      update.daysTracked,
      update.lastUpdated,
      JSON.stringify(update.phaseTrajectory),
      update.sectorRelativePerf,
      update.return7d,
      update.return30d,
      update.return90d,
      update.id,
    ],
  );
}

/**
 * tracked_stock을 EXITED 상태로 전환한다.
 * 에이전트가 수동으로 해제하거나 조기 종료 시 사용한다.
 */
export async function exitTrackedStock(
  id: number,
  exitDate: string,
  exitReason: string,
): Promise<void> {
  await pool.query(
    `UPDATE tracked_stocks
     SET status = 'EXITED', exit_date = $1, exit_reason = $2
     WHERE id = $3`,
    [exitDate, exitReason, id],
  );
}

/**
 * tracked_stock을 EXPIRED 상태로 전환한다.
 * 90일 윈도우 만료 시 ETL이 호출한다.
 */
export async function expireTrackedStock(
  id: number,
  exitDate: string,
): Promise<void> {
  await pool.query(
    `UPDATE tracked_stocks
     SET status = 'EXPIRED', exit_date = $1, exit_reason = 'tracking_window_expired'
     WHERE id = $2`,
    [exitDate, id],
  );
}

/**
 * tracked_stock의 tier를 변경한다.
 * standard -> featured 승격 또는 그 반대.
 */
export async function updateTrackedStockTier(
  id: number,
  tier: TrackedStockTier,
): Promise<void> {
  await pool.query(
    `UPDATE tracked_stocks SET tier = $1 WHERE id = $2`,
    [tier, id],
  );
}
