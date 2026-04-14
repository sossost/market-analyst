/**
 * update-tracked-stocks.ts — ACTIVE tracked_stocks 일간 갱신 ETL.
 *
 * 기존 update-recommendation-status + update-watchlist-tracking을 통합한다.
 * trailing stop / hard stop / phase exit 로직 없음.
 * 90일 만료 처리 + 7d/30d/90d 듀레이션 수익률 스냅샷.
 *
 * Issue #773 — tracked_stocks 통합 ETL Phase 2
 */

import "dotenv/config";
import { pool } from "@/db/client";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { logger } from "@/lib/logger";
import {
  findActiveTrackedStocks,
  updateTracking,
  expireTrackedStock,
  type TrackedStockRow,
} from "@/db/repositories/trackedStocksRepository.js";
import {
  findSectorRsByName,
} from "@/db/repositories/sectorRepository.js";

const TAG = "UPDATE_TRACKED_STOCKS";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const DURATION_7D = 7;
const DURATION_30D = 30;
const DURATION_90D = 90;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface TrajectoryPoint {
  date: string;
  phase: number;
  rsScore: number | null;
}

// ─── 순수 함수 (테스트 가능) ───────────────────────────────────────────────────

/**
 * 현재 수익률(%)을 계산한다.
 * 진입가 또는 현재가가 0이거나 null이면 null 반환.
 */
export function calculatePnlPercent(
  entryPrice: number | null,
  currentPrice: number | null,
): number | null {
  if (entryPrice == null || entryPrice === 0) return null;
  if (currentPrice == null || currentPrice === 0) return null;

  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * 최대 수익률을 갱신한다.
 * 현재 PnL이 기존 max보다 크면 현재 PnL, 아니면 기존 max 유지.
 * 둘 다 null이면 null.
 */
export function calculateMaxPnlPercent(
  existingMax: number | null,
  currentPnl: number | null,
): number | null {
  if (existingMax == null && currentPnl == null) return null;
  if (existingMax == null) return currentPnl;
  if (currentPnl == null) return existingMax;

  return Math.max(existingMax, currentPnl);
}

/**
 * 트래킹 만료 여부를 판정한다.
 * 현재 날짜가 tracking_end_date를 초과하면 만료.
 * tracking_end_date가 null이면 만료되지 않음.
 */
export function isExpired(
  currentDate: string,
  trackingEndDate: string | null,
): boolean {
  if (trackingEndDate == null) return false;
  return currentDate > trackingEndDate;
}

/**
 * 트래킹 경과일을 계산한다.
 * 음수는 0으로 clamp한다.
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

/**
 * phase_trajectory에 새 포인트를 추가한다.
 * 동일 날짜가 존재하면 교체(최신 데이터 우선).
 * 날짜 오름차순 정렬. 불변성 유지.
 */
export function buildUpdatedTrajectory(
  existing: TrajectoryPoint[] | null,
  newPoint: TrajectoryPoint,
): TrajectoryPoint[] {
  const base = existing ?? [];
  const filtered = base.filter((p) => p.date !== newPoint.date);
  return [...filtered, newPoint].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 듀레이션 수익률 스냅샷을 계산한다.
 *
 * - existingSnapshot이 이미 존재하면 변경하지 않는다 (immutable snapshot).
 * - entry_date + durationDays 미도달이면 null 반환.
 * - currentPrice가 null이면 null 반환.
 */
export function calculateDurationReturn(params: {
  entryDate: string;
  entryPrice: number;
  currentDate: string;
  currentPrice: number | null;
  existingSnapshot: number | null;
  durationDays: number;
}): number | null {
  const { entryDate, entryPrice, currentDate, currentPrice, existingSnapshot, durationDays } = params;

  if (existingSnapshot != null) return existingSnapshot;
  if (currentPrice == null || currentPrice === 0) return null;
  if (entryPrice === 0) return null;

  const entry = new Date(`${entryDate}T00:00:00Z`);
  entry.setUTCDate(entry.getUTCDate() + durationDays);
  const snapshotDate = entry.toISOString().slice(0, 10);

  if (currentDate < snapshotDate) return null;

  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

// ─── DB 쿼리 헬퍼 ─────────────────────────────────────────────────────────────

interface StockPhaseData {
  phase: number;
  rsScore: number | null;
}

async function fetchStockPhase(
  symbol: string,
  date: string,
): Promise<StockPhaseData | null> {
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

async function fetchSectorRelativePerf(
  sector: string | null,
  rsScore: number | null,
  date: string,
): Promise<number | null> {
  if (sector == null || rsScore == null) return null;

  try {
    const row = await retryDatabaseOperation(() => findSectorRsByName(sector, date));
    if (row == null) return null;

    const sectorAvgRs = toNum(row.avg_rs);
    if (sectorAvgRs === 0) return null;
    return rsScore - sectorAvgRs;
  } catch {
    return null;
  }
}

// ─── 단일 종목 처리 ───────────────────────────────────────────────────────────

type ProcessResult =
  | { action: "expired"; symbol: string }
  | { action: "updated"; symbol: string }
  | { action: "skipped"; symbol: string; reason: string };

async function processTrackedStock(
  item: TrackedStockRow,
  date: string,
): Promise<ProcessResult> {
  // 만료 검사 (최우선)
  if (isExpired(date, item.tracking_end_date)) {
    await retryDatabaseOperation(() => expireTrackedStock(item.id, date));
    logger.info(TAG, `${item.symbol}: 90일 만료 → EXPIRED`);
    return { action: "expired", symbol: item.symbol };
  }

  // Phase, RS 조회
  const phaseData = await retryDatabaseOperation(() =>
    fetchStockPhase(item.symbol, date),
  );

  // 종가 조회
  const currentPrice = await retryDatabaseOperation(() =>
    fetchLatestClose(item.symbol, date),
  );

  if (currentPrice == null) {
    logger.info(TAG, `${item.symbol}: 종가 없음 — 스킵`);
    return { action: "skipped", symbol: item.symbol, reason: "no_price" };
  }

  // 수익률 계산
  const entryPrice = toNum(item.entry_price);
  const pnlPercent = calculatePnlPercent(entryPrice === 0 ? null : entryPrice, currentPrice);
  const prevMax = item.max_pnl_percent != null ? toNum(item.max_pnl_percent) : null;
  const maxPnlPercent = calculateMaxPnlPercent(prevMax === 0 ? null : prevMax, pnlPercent);

  // 경과일
  const daysTracked = calculateDaysTracked(item.entry_date, date);

  // Phase trajectory 누적
  const newPoint: TrajectoryPoint = {
    date,
    phase: phaseData?.phase ?? (item.current_phase ?? item.entry_phase),
    rsScore: phaseData?.rsScore ?? null,
  };
  const phaseTrajectory = buildUpdatedTrajectory(
    item.phase_trajectory as TrajectoryPoint[] | null,
    newPoint,
  );

  // 섹터 상대 성과
  const sectorRelativePerf = await fetchSectorRelativePerf(
    item.entry_sector,
    phaseData?.rsScore ?? null,
    date,
  );

  // 듀레이션 수익률 스냅샷 (entry_date 기준)
  const entryPriceClean = entryPrice === 0 ? 0 : entryPrice;
  const return7d = calculateDurationReturn({
    entryDate: item.entry_date,
    entryPrice: entryPriceClean,
    currentDate: date,
    currentPrice,
    existingSnapshot: item.return_7d != null ? toNum(item.return_7d) : null,
    durationDays: DURATION_7D,
  });
  const return30d = calculateDurationReturn({
    entryDate: item.entry_date,
    entryPrice: entryPriceClean,
    currentDate: date,
    currentPrice,
    existingSnapshot: item.return_30d != null ? toNum(item.return_30d) : null,
    durationDays: DURATION_30D,
  });
  const return90d = calculateDurationReturn({
    entryDate: item.entry_date,
    entryPrice: entryPriceClean,
    currentDate: date,
    currentPrice,
    existingSnapshot: item.return_90d != null ? toNum(item.return_90d) : null,
    durationDays: DURATION_90D,
  });

  await retryDatabaseOperation(() =>
    updateTracking({
      id: item.id,
      currentPhase: newPoint.phase,
      currentRsScore: newPoint.rsScore,
      currentPrice,
      pnlPercent,
      maxPnlPercent,
      daysTracked,
      lastUpdated: date,
      phaseTrajectory,
      sectorRelativePerf,
      return7d,
      return30d,
      return90d,
    }),
  );

  logger.info(
    TAG,
    `${item.symbol}: Phase ${newPoint.phase}, RS ${newPoint.rsScore ?? "N/A"}, PnL ${pnlPercent?.toFixed(1) ?? "N/A"}%`,
  );

  return { action: "updated", symbol: item.symbol };
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  const activeItems = await retryDatabaseOperation(() => findActiveTrackedStocks());

  if (activeItems.length === 0) {
    logger.info(TAG, "ACTIVE tracked_stocks 없음. 스킵.");
    await pool.end();
    return;
  }

  logger.info(TAG, `ACTIVE tracked_stocks ${activeItems.length}건 처리 시작`);

  let updatedCount = 0;
  let expiredCount = 0;
  let skippedCount = 0;

  for (const item of activeItems) {
    try {
      const result = await processTrackedStock(item, targetDate);
      if (result.action === "updated") updatedCount++;
      else if (result.action === "expired") expiredCount++;
      else skippedCount++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(TAG, `${item.symbol}: 처리 실패 — ${reason}`);
      skippedCount++;
    }
  }

  logger.info(
    TAG,
    `완료 — 갱신: ${updatedCount}, 만료: ${expiredCount}, 스킵: ${skippedCount}`,
  );

  await pool.end();
}

main().catch(async (err) => {
  logger.error(
    TAG,
    `update-tracked-stocks 실패: ${err instanceof Error ? err.message : String(err)}`,
  );
  await pool.end();
  process.exit(1);
});
