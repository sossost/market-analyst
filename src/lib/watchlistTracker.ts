/**
 * Watchlist Tracker — 90일 Phase 궤적 추적.
 *
 * ACTIVE watchlist의 Phase, RS score, 가격을 매일 phase_trajectory에 누적하며,
 * 섹터 대비 상대 성과를 계산한다.
 * 90일 초과 시 EXITED 처리하고, PnL을 참고 지표로 계산한다.
 */

import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import {
  findActiveWatchlist,
  updateWatchlistTracking,
  exitWatchlistItem,
  type ActiveWatchlistRow,
} from "@/db/repositories/watchlistRepository.js";
import {
  findSectorRsByName,
} from "@/db/repositories/sectorRepository.js";
import { logger } from "@/lib/logger";
import { pool } from "@/db/client";

// ─── Constants ────────────────────────────────────────────────────────────────

/** 관심종목 트래킹 최대 기간 (캘린더일) */
const TRACKING_WINDOW_DAYS = 90;

/** 90일 만료로 인한 EXITED 사유 */
const EXIT_REASON_EXPIRED = "90일 트래킹 기간 만료";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrajectoryPoint {
  date: string;
  phase: number;
  rsScore: number | null;
}

export interface TrackingUpdateResult {
  symbol: string;
  action: "updated" | "exited";
  exitReason?: string;
}

export interface TrackerRunResult {
  date: string;
  totalActive: number;
  updated: number;
  exited: number;
  details: TrackingUpdateResult[];
}

// ─── Pure Logic (testable without DB) ────────────────────────────────────────

/**
 * 기존 phase_trajectory에 새 포인트를 추가한다.
 * 동일 날짜가 이미 존재하면 교체(최신 데이터 우선), 없으면 추가한다.
 * 불변성 유지 — 원본 배열을 변경하지 않는다.
 */
export function appendTrajectoryPoint(
  existing: TrajectoryPoint[],
  newPoint: TrajectoryPoint,
): TrajectoryPoint[] {
  const filtered = existing.filter((p) => p.date !== newPoint.date);
  return [...filtered, newPoint].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * PnL 비율을 계산한다.
 * 진입가 또는 현재가가 0이거나 null이면 null 반환.
 */
export function calculatePnlPercent(
  priceAtEntry: number | null,
  currentPrice: number | null,
): number | null {
  if (priceAtEntry == null || priceAtEntry === 0) return null;
  if (currentPrice == null || currentPrice === 0) return null;

  return ((currentPrice - priceAtEntry) / priceAtEntry) * 100;
}

/**
 * max_pnl_percent를 갱신한다.
 * 현재 PnL이 기존 max보다 크면 갱신, 아니면 기존 값 유지.
 * null 처리: 둘 다 null이면 null, 하나라도 있으면 그 값 사용.
 */
export function updateMaxPnl(
  existingMax: number | null,
  currentPnl: number | null,
): number | null {
  if (existingMax == null && currentPnl == null) return null;
  if (existingMax == null) return currentPnl;
  if (currentPnl == null) return existingMax;

  return Math.max(existingMax, currentPnl);
}

/**
 * 트래킹 종료 여부를 판정한다.
 * 현재 날짜가 tracking_end_date를 초과하면 만료.
 */
export function isTrackingExpired(
  currentDate: string,
  trackingEndDate: string | null,
): boolean {
  if (trackingEndDate == null) return false;
  return currentDate > trackingEndDate;
}

/**
 * entry_date로부터 90일 뒤의 날짜를 계산한다.
 */
export function calculateTrackingEndDate(entryDate: string): string {
  const d = new Date(`${entryDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + TRACKING_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * 트래킹 경과일을 계산한다.
 */
export function calculateDaysTracked(
  entryDate: string,
  currentDate: string,
): number {
  const entry = new Date(`${entryDate}T00:00:00Z`);
  const current = new Date(`${currentDate}T00:00:00Z`);
  const diffMs = current.getTime() - entry.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

// ─── DB 쿼리 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * 지정 종목과 날짜의 Phase, RS 점수를 stock_phases 테이블에서 조회한다.
 */
async function fetchStockPhase(
  symbol: string,
  date: string,
): Promise<{ phase: number; rsScore: number | null } | null> {
  const { rows } = await pool.query<{ phase: number; rs_score: number | null }>(
    `SELECT phase, rs_score
     FROM stock_phases
     WHERE symbol = $1 AND date = $2
     LIMIT 1`,
    [symbol, date],
  );

  const row = rows[0];
  if (row == null) return null;

  return { phase: row.phase, rsScore: row.rs_score };
}

/**
 * 지정 종목의 최신 종가를 daily_prices 테이블에서 조회한다.
 */
async function fetchLatestClose(
  symbol: string,
  date: string,
): Promise<number | null> {
  const { rows } = await pool.query<{ close: string | null }>(
    `SELECT close::text
     FROM daily_prices
     WHERE symbol = $1 AND date <= $2
     ORDER BY date DESC
     LIMIT 1`,
    [symbol, date],
  );

  const row = rows[0];
  if (row == null || row.close == null) return null;

  const close = toNum(row.close);
  return close === 0 ? null : close;
}

/**
 * 섹터의 최신 avg_rs를 조회한다.
 * 섹터 대비 상대 성과 계산에 사용.
 */
async function fetchSectorAvgRs(
  sector: string | null,
  date: string,
): Promise<number | null> {
  if (sector == null) return null;

  try {
    const row = await retryDatabaseOperation(() =>
      findSectorRsByName(sector, date),
    );

    if (row == null) return null;
    const avgRs = toNum(row.avg_rs);
    return avgRs === 0 ? null : avgRs;
  } catch {
    return null;
  }
}

/**
 * 섹터 대비 상대 성과를 계산한다.
 * 개별 RS - 섹터 평균 RS.
 */
function calculateSectorRelativePerf(
  rsScore: number | null,
  sectorAvgRs: number | null,
): number | null {
  if (rsScore == null || sectorAvgRs == null) return null;
  return rsScore - sectorAvgRs;
}

// ─── Main Tracker Logic ───────────────────────────────────────────────────────

/**
 * 단일 watchlist 항목을 갱신한다.
 * 90일 초과 시 EXITED 처리, 아니면 트래킹 데이터 갱신.
 */
async function processWatchlistItem(
  item: ActiveWatchlistRow,
  date: string,
): Promise<TrackingUpdateResult> {
  // 90일 만료 검사
  if (isTrackingExpired(date, item.tracking_end_date)) {
    await retryDatabaseOperation(() =>
      exitWatchlistItem(item.id, date, EXIT_REASON_EXPIRED),
    );

    logger.info(
      "WatchlistTracker",
      `${item.symbol}: 90일 트래킹 기간 만료 → EXITED`,
    );

    return { symbol: item.symbol, action: "exited", exitReason: EXIT_REASON_EXPIRED };
  }

  // Phase, RS 조회
  const phaseData = await retryDatabaseOperation(() =>
    fetchStockPhase(item.symbol, date),
  );

  // 종가 조회
  const currentPrice = await retryDatabaseOperation(() =>
    fetchLatestClose(item.symbol, date),
  );

  // 섹터 RS 조회 (상대 성과 계산용)
  const sectorAvgRs = await fetchSectorAvgRs(item.entry_sector, date);

  // trajectory 갱신
  const existingTrajectory: TrajectoryPoint[] = item.phase_trajectory ?? [];
  const newPoint: TrajectoryPoint = {
    date,
    phase: phaseData?.phase ?? (item.current_phase ?? item.entry_phase),
    rsScore: phaseData?.rsScore ?? null,
  };
  const updatedTrajectory = appendTrajectoryPoint(existingTrajectory, newPoint);

  // PnL 계산
  const priceAtEntry = item.price_at_entry != null ? toNum(item.price_at_entry) : null;
  const priceAtEntryClean = priceAtEntry === 0 ? null : priceAtEntry;
  const pnlPercent = calculatePnlPercent(priceAtEntryClean, currentPrice);
  const existingMaxPnl = item.max_pnl_percent != null ? toNum(item.max_pnl_percent) : null;
  const maxPnlPercent = updateMaxPnl(existingMaxPnl === 0 ? null : existingMaxPnl, pnlPercent);

  // 섹터 상대 성과
  const sectorRelativePerf = calculateSectorRelativePerf(
    phaseData?.rsScore ?? null,
    sectorAvgRs,
  );

  // daysTracked 계산
  const daysTracked = calculateDaysTracked(item.entry_date, date);

  await retryDatabaseOperation(() =>
    updateWatchlistTracking({
      id: item.id,
      currentPhase: newPoint.phase,
      currentRsScore: newPoint.rsScore,
      phaseTrajectory: updatedTrajectory,
      sectorRelativePerf,
      currentPrice,
      pnlPercent,
      maxPnlPercent,
      daysTracked,
      lastUpdated: date,
    }),
  );

  logger.info(
    "WatchlistTracker",
    `${item.symbol}: Phase ${newPoint.phase}, RS ${newPoint.rsScore ?? "N/A"}, PnL ${pnlPercent?.toFixed(1) ?? "N/A"}%`,
  );

  return { symbol: item.symbol, action: "updated" };
}

/**
 * 모든 ACTIVE watchlist 항목의 트래킹 데이터를 갱신한다.
 * ETL Phase 3.8에서 매일 호출.
 *
 * @param date - 기준 날짜 (YYYY-MM-DD)
 */
export async function runWatchlistTracking(date: string): Promise<TrackerRunResult> {
  const activeItems = await retryDatabaseOperation(() => findActiveWatchlist());

  logger.info("WatchlistTracker", `ACTIVE watchlist ${activeItems.length}건 트래킹 시작 (기준: ${date})`);

  const details: TrackingUpdateResult[] = [];

  // 순차 처리 — 각 항목이 독립적이지만 DB 부하 고려
  for (const item of activeItems) {
    try {
      const result = await processWatchlistItem(item, date);
      details.push(result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("WatchlistTracker", `${item.symbol}: 처리 실패 — ${reason}`);
      details.push({ symbol: item.symbol, action: "updated" });
    }
  }

  const exited = details.filter((d) => d.action === "exited").length;
  const updated = details.filter((d) => d.action === "updated").length;

  logger.info(
    "WatchlistTracker",
    `트래킹 완료: ${updated}건 갱신, ${exited}건 만료`,
  );

  return {
    date,
    totalActive: activeItems.length,
    updated,
    exited,
    details,
  };
}
