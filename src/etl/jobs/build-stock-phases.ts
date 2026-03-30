import "dotenv/config";
import { db, pool } from "@/db/client";
import { stockPhases } from "@/db/schema/analyst";
import { detectPhase } from "@/lib/phase-detection";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { chunk, toNum, resolveVolumeConfirmed } from "@/etl/utils/common";
import { sql } from "drizzle-orm";
import type { PhaseInput } from "@/types";
import { logger } from "@/lib/logger";
import {
  findActiveNonEtfSymbols,
  findHighLowStartDate,
  findClosePricesForBatch,
  findMaDataForBatch,
  findVolumeForBatch,
  findVolumeHistoryForBatch,
  findRsScoresForBatch,
  findHighLowForBatch,
  findPrevPhasesForBatch,
} from "@/db/repositories/index.js";

const TAG = "BUILD_STOCK_PHASES";

const BATCH_SIZE = 200;
const CLOSE_DAYS_NEEDED = 170; // 150 for MA150 + 20 for slope
const HIGH_LOW_DAYS = 252; // ~1 year trading days
const VDU_SHORT_PERIOD = 5; // VDU ratio: short-term average window
const VDU_LONG_PERIOD = 50; // VDU ratio: long-term average window

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.error(TAG, "No trade date found in daily_prices. Exiting.");
    process.exit(1);
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  // Get all active, non-ETF symbols
  const symbolRows = await retryDatabaseOperation(() =>
    findActiveNonEtfSymbols(),
  );

  logger.info(TAG, `Active symbols: ${symbolRows.length}`);

  // Pre-compute 52-week start date (shared across all batches)
  const startDateRow = await retryDatabaseOperation(() =>
    findHighLowStartDate(targetDate, HIGH_LOW_DAYS),
  );
  const highLowStartDate = startDateRow?.start_date ?? targetDate;

  const batches = chunk(symbolRows, BATCH_SIZE);
  let processed = 0;
  let phase2Count = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchSymbols = batch.map((s) => s.symbol);

    logger.info(
      TAG,
      `Batch ${i + 1}/${batches.length} (${batchSymbols.length} symbols)`,
    );

    // 1. Fetch close prices for MA150 calculation
    const closeRows = await retryDatabaseOperation(() =>
      findClosePricesForBatch(batchSymbols, targetDate),
    );

    const closesBySymbol = new Map<string, { date: string; close: number }[]>();
    for (const row of closeRows) {
      if (row.close == null) continue;
      const arr = closesBySymbol.get(row.symbol) ?? [];
      arr.push({ date: row.date, close: toNum(row.close) });
      closesBySymbol.set(row.symbol, arr);
    }

    // 2. Fetch MA data (today) — includes vol_ma30 for volume ratio
    const maRows = await retryDatabaseOperation(() =>
      findMaDataForBatch(batchSymbols, targetDate),
    );
    const maBySymbol = new Map(maRows.map((r) => [r.symbol, r]));

    // 2b. Fetch today's volume for vol_ratio calculation
    const volRows = await retryDatabaseOperation(() =>
      findVolumeForBatch(batchSymbols, targetDate),
    );
    const volBySymbol = new Map<string, number>();
    for (const row of volRows) {
      if (row.volume != null) {
        volBySymbol.set(row.symbol, toNum(row.volume));
      }
    }

    // 2c. Fetch volume history for VDU ratio (5-day avg / 50-day avg)
    const volHistRows = await retryDatabaseOperation(() =>
      findVolumeHistoryForBatch(batchSymbols, targetDate, VDU_LONG_PERIOD),
    );
    const volHistBySymbol = new Map<string, number[]>();
    for (const row of volHistRows) {
      if (row.volume == null) continue;
      const arr = volHistBySymbol.get(row.symbol) ?? [];
      arr.push(toNum(row.volume));
      volHistBySymbol.set(row.symbol, arr);
    }

    // 3. Fetch RS scores (today)
    const rsRows = await retryDatabaseOperation(() =>
      findRsScoresForBatch(batchSymbols, targetDate),
    );
    const rsBySymbol = new Map<string, number>();
    for (const row of rsRows) {
      if (row.rs_score != null) {
        rsBySymbol.set(row.symbol, row.rs_score);
      }
    }

    // 4. Fetch 52-week high/low (using pre-computed start date)
    const highLowRows = await retryDatabaseOperation(() =>
      findHighLowForBatch(batchSymbols, highLowStartDate, targetDate),
    );
    const highLowBySymbol = new Map(
      highLowRows.map((r) => [
        r.symbol,
        { high: toNum(r.high_52w), low: toNum(r.low_52w) },
      ]),
    );

    // 5. Fetch previous day's phases + volume_confirmed for transition detection
    const prevPhaseRows = await retryDatabaseOperation(() =>
      findPrevPhasesForBatch(batchSymbols, targetDate),
    );
    const prevPhaseBySymbol = new Map(
      prevPhaseRows.map((r) => [r.symbol, r.phase]),
    );
    const prevVolConfirmedBySymbol = new Map(
      prevPhaseRows.map((r) => [r.symbol, r.volume_confirmed]),
    );

    // 6. Calculate phase for each symbol
    const upsertRows: UpsertRow[] = [];

    for (const sym of batch) {
      const closes = closesBySymbol.get(sym.symbol);
      if (closes == null || closes.length < 150) continue;

      const ma = maBySymbol.get(sym.symbol);
      if (ma == null) continue;

      const ma150Today = calculateMa150(closes, 0, 150);
      const ma150_20dAgo =
        closes.length >= CLOSE_DAYS_NEEDED
          ? calculateMa150(closes, 20, 150)
          : ma150Today;

      const rsScore = rsBySymbol.get(sym.symbol) ?? 50;
      const highLow = highLowBySymbol.get(sym.symbol) ?? { high: 0, low: 0 };
      const price = closes[0].close;

      const input: PhaseInput = {
        price,
        ma50: toNum(ma.ma50),
        ma150: ma150Today,
        ma200: toNum(ma.ma200),
        ma150_20dAgo,
        rsScore,
        high52w: highLow.high,
        low52w: highLow.low,
      };

      const result = detectPhase(input);
      const prevPhase = prevPhaseBySymbol.get(sym.symbol) ?? null;

      // Volume ratio: today's volume / 30-day volume MA
      const volume = volBySymbol.get(sym.symbol) ?? null;
      const volMa30 = ma.vol_ma30 != null ? toNum(ma.vol_ma30) : null;
      const volRatio =
        volume != null && volMa30 != null && volMa30 > 0
          ? volume / volMa30
          : null;

      // VDU ratio: 5-day avg volume / 50-day avg volume
      const volHist = volHistBySymbol.get(sym.symbol) ?? [];
      const vduRatio = calculateVduRatio(volHist, VDU_SHORT_PERIOD, VDU_LONG_PERIOD);

      const prevVolConfirmed =
        prevVolConfirmedBySymbol.get(sym.symbol) ?? null;
      const volumeConfirmed = resolveVolumeConfirmed(
        result.phase,
        prevPhase,
        volRatio,
        prevVolConfirmed,
      );

      if (result.phase === 2) phase2Count++;

      upsertRows.push({
        symbol: sym.symbol,
        date: targetDate,
        phase: result.phase,
        prevPhase,
        ma150: ma150Today,
        ma150Slope: result.ma150Slope,
        rsScore,
        pctFromHigh52w:
          highLow.high > 0 ? (price - highLow.high) / highLow.high : null,
        pctFromLow52w:
          highLow.low > 0 ? (price - highLow.low) / highLow.low : null,
        conditionsMet: JSON.stringify(result.detail.conditionsMet),
        volRatio,
        vduRatio,
        volumeConfirmed,
      });
    }

    // 7. Batch upsert
    if (upsertRows.length > 0) {
      await retryDatabaseOperation(() => batchUpsert(upsertRows));
      processed += upsertRows.length;
    }
  }

  logger.info(TAG, `Done. Processed: ${processed}, Phase 2: ${phase2Count}`);
  await pool.end();
}

/**
 * Calculate MA150 from sorted-desc close prices.
 * offset: skip this many entries from the front (0 = today, 20 = 20 days ago)
 */
function calculateMa150(
  closes: { close: number }[],
  offset: number,
  period: number,
): number {
  const slice = closes.slice(offset, offset + period);
  if (slice.length < period) return 0;
  const sum = slice.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

/**
 * Calculate VDU (Volume Dry-Up) ratio: short-term avg volume / long-term avg volume.
 * Uses overlapping windows (long period includes short period) — this is intentional:
 * with 5/50 ratio the overlap is only 10%, and the simplicity is worth the minor compression.
 * Returns null if insufficient data.
 */
export function calculateVduRatio(
  volumes: number[],
  shortPeriod: number,
  longPeriod: number,
): number | null {
  if (volumes.length < longPeriod) return null;

  const shortAvg =
    volumes.slice(0, shortPeriod).reduce((sum, v) => sum + v, 0) / shortPeriod;
  const longAvg =
    volumes.slice(0, longPeriod).reduce((sum, v) => sum + v, 0) / longPeriod;

  if (longAvg === 0) return null;
  return shortAvg / longAvg;
}

type UpsertRow = {
  symbol: string;
  date: string;
  phase: number;
  prevPhase: number | null;
  ma150: number | null;
  ma150Slope: number | null;
  rsScore: number | null;
  pctFromHigh52w: number | null;
  pctFromLow52w: number | null;
  conditionsMet: string | null;
  volRatio: number | null;
  vduRatio: number | null;
  volumeConfirmed: boolean | null;
};

async function batchUpsert(rows: UpsertRow[]) {
  const UPSERT_BATCH = 50;
  const batches = chunk(rows, UPSERT_BATCH);

  for (const batch of batches) {
    const values = batch.map((r) => ({
      symbol: r.symbol,
      date: r.date,
      phase: r.phase,
      prevPhase: r.prevPhase,
      ma150: r.ma150 != null ? String(r.ma150) : null,
      ma150Slope: r.ma150Slope != null ? String(r.ma150Slope) : null,
      rsScore: r.rsScore,
      pctFromHigh52w:
        r.pctFromHigh52w != null ? String(r.pctFromHigh52w) : null,
      pctFromLow52w:
        r.pctFromLow52w != null ? String(r.pctFromLow52w) : null,
      conditionsMet: r.conditionsMet,
      volRatio: r.volRatio != null ? String(r.volRatio) : null,
      vduRatio: r.vduRatio != null ? String(r.vduRatio) : null,
      volumeConfirmed: r.volumeConfirmed,
    }));

    await db
      .insert(stockPhases)
      .values(values)
      .onConflictDoUpdate({
        target: [stockPhases.symbol, stockPhases.date],
        set: {
          phase: sql`EXCLUDED.phase`,
          prevPhase: sql`EXCLUDED.prev_phase`,
          ma150: sql`EXCLUDED.ma150`,
          ma150Slope: sql`EXCLUDED.ma150_slope`,
          rsScore: sql`EXCLUDED.rs_score`,
          pctFromHigh52w: sql`EXCLUDED.pct_from_high_52w`,
          pctFromLow52w: sql`EXCLUDED.pct_from_low_52w`,
          conditionsMet: sql`EXCLUDED.conditions_met`,
          volRatio: sql`EXCLUDED.vol_ratio`,
          vduRatio: sql`EXCLUDED.vdu_ratio`,
          volumeConfirmed: sql`EXCLUDED.volume_confirmed`,
        },
      });
  }
}

main().catch((err) => {
  logger.error(TAG, `build-stock-phases failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
