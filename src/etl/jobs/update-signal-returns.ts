import "dotenv/config";
import { db, pool } from "@/db/client";
import { signalLog } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { computeSignalReturns } from "@/lib/signal-logic";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  findCurrentPriceAndPhase,
  findTradingDaysBetween,
} from "@/db/repositories/index.js";

const TAG = "UPDATE_SIGNAL_RETURNS";

/**
 * 매일 ETL 후 실행: ACTIVE 시그널의 수익률을 업데이트한다.
 *
 * 흐름:
 * 1. ACTIVE 시그널 조회
 * 2. 현재 종가 + Phase 조회
 * 3. 수익률 계산 + 종료 판단
 * 4. DB 업데이트
 */
async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping signal return update.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  // 1. ACTIVE 시그널 조회
  const activeSignals = await retryDatabaseOperation(() =>
    db
      .select()
      .from(signalLog)
      .where(eq(signalLog.status, "ACTIVE")),
  );

  if (activeSignals.length === 0) {
    logger.info(TAG, "No active signals. Nothing to update.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Active signals: ${activeSignals.length}`);

  const symbols = activeSignals.map((s) => s.symbol);

  // 2. 현재 종가 + Phase 조회
  const dataRows = await retryDatabaseOperation(() =>
    findCurrentPriceAndPhase(symbols, targetDate),
  );
  const dataBySymbol = new Map(
    dataRows.map((r) => [
      r.symbol,
      { price: toNum(r.close), phase: r.phase },
    ]),
  );

  // 3. 거래일 수 계산용: entry_date ~ targetDate 사이 거래일 수 일괄 조회
  const entryDates = [...new Set(activeSignals.map((s) => s.entryDate))];
  const tradingDayRows = await retryDatabaseOperation(() =>
    findTradingDaysBetween(entryDates, targetDate),
  );
  const tradingDaysByEntry = new Map(
    tradingDayRows.map((r) => [r.entry_date, Number(r.trading_days)]),
  );

  // 4. 각 시그널 업데이트
  let closedCount = 0;

  for (const signal of activeSignals) {
    const data = dataBySymbol.get(signal.symbol);
    if (data == null || data.price === 0) continue;

    const entryPrice = toNum(signal.entryPrice);
    if (entryPrice === 0) continue;

    const daysHeld = tradingDaysByEntry.get(signal.entryDate) ?? (signal.daysHeld ?? 0) + 1;

    const result = computeSignalReturns({
      entryPrice,
      currentPrice: data.price,
      daysHeld,
      currentPhase: data.phase,
      prevMaxReturn: toNum(signal.maxReturn),
      prevReturn5d: signal.return5d != null ? toNum(signal.return5d) : null,
      prevReturn10d: signal.return10d != null ? toNum(signal.return10d) : null,
      prevReturn20d: signal.return20d != null ? toNum(signal.return20d) : null,
      prevReturn60d: signal.return60d != null ? toNum(signal.return60d) : null,
    });

    const updateFields: Record<string, unknown> = {
      daysHeld: result.daysHeld,
      maxReturn: String(result.maxReturn),
      lastUpdated: targetDate,
    };

    if (result.return5d != null) updateFields.return5d = String(result.return5d);
    if (result.return10d != null) updateFields.return10d = String(result.return10d);
    if (result.return20d != null) updateFields.return20d = String(result.return20d);
    if (result.return60d != null) updateFields.return60d = String(result.return60d);

    if (result.shouldClose) {
      updateFields.status = "CLOSED";
      updateFields.phaseExitDate = targetDate;
      updateFields.phaseExitReturn = String(result.currentReturn);
      closedCount++;
    }

    await retryDatabaseOperation(() =>
      db
        .update(signalLog)
        .set(updateFields)
        .where(eq(signalLog.id, signal.id)),
    );
  }

  logger.info(
    TAG,
    `Done. Updated: ${activeSignals.length}, Closed today: ${closedCount}`,
  );
  await pool.end();
}

main().catch((err) => {
  logger.error(TAG, `update-signal-returns failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
