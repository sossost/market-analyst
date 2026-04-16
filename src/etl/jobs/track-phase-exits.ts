import "dotenv/config";
import { db, pool } from "@/db/client";
import { signalLog } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { isPhase2Reverted } from "@/etl/utils/phase";
import { collectFailureConditions } from "@/lib/marketConditionCollector";
import { eq, sql, isNull, and } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { findPhaseAndLowSinceEntry } from "@/db/repositories/index.js";

const TAG = "TRACK_PHASE_EXITS";

/**
 * Phase 2 회귀 추적 ETL.
 *
 * signal_log에서 아직 회귀 판정이 안 된 레코드를 순회하며,
 * Phase 2 → Phase 1 또는 Phase 4 전환 여부를 감지한다.
 *
 * 흐름:
 * 1. phase2_reverted IS NULL인 레코드 조회
 * 2. 각 종목의 현재 phase를 stock_phases에서 조회
 * 3. Phase 2가 아닌 경우 → 회귀 감지, 위양성 지표 업데이트
 * 4. Phase 2 유지 중인 경우 → 스킵
 */

// ─── Pure logic (exported for testing) ──────────────────────────────

/**
 * 진입가 대비 최대 역행 폭(%) 계산.
 * 역행이 없으면 0을 반환한다.
 */
export function calculateMaxAdverseMove(
  entryPrice: number,
  lowPrice: number,
): number {
  if (entryPrice <= 0) return 0;
  const move = ((entryPrice - lowPrice) / entryPrice) * 100;
  return Math.max(0, move);
}

/**
 * 두 날짜 사이의 달력 일수를 계산한다.
 */
export function calculateDaysBetween(
  startDate: string,
  endDate: string,
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

// isPhase2Reverted는 @/etl/utils/phase에서 re-export
export { isPhase2Reverted } from "@/etl/utils/phase";

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping phase exit tracking.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Track phase exits — date: ${targetDate}`);

  // 1. phase2_reverted가 아직 판정되지 않은 ACTIVE 시그널 조회
  const pendingSignals = await retryDatabaseOperation(() =>
    db
      .select()
      .from(signalLog)
      .where(
        and(
          isNull(signalLog.phase2Reverted),
          eq(signalLog.status, "ACTIVE"),
        ),
      ),
  );

  if (pendingSignals.length === 0) {
    logger.info(TAG, "No pending signals to track.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Pending signals: ${pendingSignals.length}`);

  // 2. 각 종목의 현재 phase 일괄 조회
  const symbols = pendingSignals.map((s) => s.symbol);
  const phaseRows = await retryDatabaseOperation(() =>
    findPhaseAndLowSinceEntry(symbols, targetDate),
  );

  const phaseBySymbol = new Map(
    phaseRows.map((r) => [
      r.symbol,
      { phase: r.phase, lowSinceEntry: r.low_since_entry },
    ]),
  );

  // 3. 회귀 감지 — 먼저 회귀 대상을 필터링하고 배치로 처리
  let skippedCount = 0;

  interface RevertedSignal {
    signal: typeof pendingSignals[number];
    timeToRevert: number;
    maxAdverseMove: number;
  }

  const revertedSignals: RevertedSignal[] = [];

  for (const signal of pendingSignals) {
    const phaseData = phaseBySymbol.get(signal.symbol);

    if (phaseData == null) {
      skippedCount++;
      continue;
    }

    if (!isPhase2Reverted(phaseData.phase)) {
      continue;
    }

    const entryPrice = toNum(signal.entryPrice);
    const lowPrice = phaseData.lowSinceEntry != null
      ? toNum(phaseData.lowSinceEntry)
      : entryPrice;

    revertedSignals.push({
      signal,
      timeToRevert: calculateDaysBetween(signal.entryDate, targetDate),
      maxAdverseMove: calculateMaxAdverseMove(entryPrice, lowPrice),
    });
  }

  // 회귀 시그널에 대해 시장 조건 수집 + DB 업데이트를 동시성 제한으로 병렬 처리
  const CONCURRENCY_LIMIT = 5;
  let revertedCount = 0;

  for (let i = 0; i < revertedSignals.length; i += CONCURRENCY_LIMIT) {
    const batch = revertedSignals.slice(i, i + CONCURRENCY_LIMIT);

    await Promise.all(
      batch.map(async ({ signal, timeToRevert, maxAdverseMove }) => {
        const failureConditions = await collectFailureConditions(
          signal.symbol,
          targetDate,
          db,
        );

        await retryDatabaseOperation(() =>
          db
            .update(signalLog)
            .set({
              phase2Reverted: true,
              timeToRevert,
              maxAdverseMove: String(maxAdverseMove.toFixed(2)),
              failureConditions: JSON.stringify(failureConditions),
            })
            .where(eq(signalLog.id, signal.id)),
        );

        logger.info(
          TAG,
          `  REVERTED: ${signal.symbol} (${timeToRevert}d, adverse ${maxAdverseMove.toFixed(1)}%)`,
        );
      }),
    );

    revertedCount += batch.length;
  }

  // 4. CLOSED 상태 시그널의 Phase 2 회귀 여부 마킹.
  // 제한사항: signal_log에 closeReason 컬럼이 없으므로, CLOSED가 반드시
  // "Phase 2 성공 유지"를 의미하지는 않는다 (기간 만료 등 다른 사유 가능).
  // 현재는 CLOSED + phase2Reverted IS NULL이면 일괄 성공(false)으로 마킹한다.
  // stock_phases 기반 정밀 판정은 closeReason 컬럼 추가 후 개선 예정.
  const closedSignals = await retryDatabaseOperation(() =>
    db
      .select()
      .from(signalLog)
      .where(
        and(
          isNull(signalLog.phase2Reverted),
          eq(signalLog.status, "CLOSED"),
        ),
      ),
  );

  let successCount = 0;

  // 병렬 업데이트 (동시성 제한)
  for (let i = 0; i < closedSignals.length; i += CONCURRENCY_LIMIT) {
    const batch = closedSignals.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map((signal) =>
        retryDatabaseOperation(() =>
          db
            .update(signalLog)
            .set({ phase2Reverted: false })
            .where(eq(signalLog.id, signal.id)),
        ),
      ),
    );
    successCount += batch.length;
  }

  logger.info(
    TAG,
    `Results: ${revertedCount} reverted, ${successCount} success-closed, ${skippedCount} skipped (no phase data)`,
  );
  await pool.end();
}

main().catch(async (err) => {
  logger.error(TAG, `track-phase-exits failed: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});
