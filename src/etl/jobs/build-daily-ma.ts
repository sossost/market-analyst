import "dotenv/config";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { dailyMa } from "@/db/schema/market";
import { sleep } from "@/etl/utils/common";
import { validateDatabaseOnlyEnvironment } from "@/etl/utils/validation";
import {
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { validateMovingAverageData } from "@/etl/utils/validation";
import { logger } from "@/lib/logger";

const TAG = "BUILD_DAILY_MA";

const BATCH_SIZE = 100;
const PAUSE_MS = 50;

async function calculateMAForSymbol(symbol: string, targetDate: string) {
  logger.info(TAG, `Calculating MA for ${symbol} on ${targetDate}`);

  const prices = await retryDatabaseOperation(
    () =>
      db.execute(sql`
      SELECT
        date,
        adj_close::numeric as close,
        volume::numeric as volume
      FROM daily_prices
      WHERE symbol = ${symbol}
        AND date <= ${targetDate}
        AND adj_close IS NOT NULL
      ORDER BY date DESC
      LIMIT 220
    `),
    DEFAULT_RETRY_OPTIONS,
  );

  const priceRows = (prices.rows as Record<string, unknown>[]).reverse();

  if (priceRows.length < 200) {
    logger.info(
      TAG,
      `Insufficient data for ${symbol}: ${priceRows.length} days (need 200+)`,
    );
    return null;
  }

  const ma20 = calculateMA(priceRows, 20);
  const ma50 = calculateMA(priceRows, 50);
  const ma100 = calculateMA(priceRows, 100);
  const ma200 = calculateMA(priceRows, 200);
  const volMa30 = calculateVolumeMA(priceRows, 30);

  const allMaPresent =
    ma20 != null && ma50 != null && ma100 != null && ma200 != null;
  let maCompressionPct: number | null = null;
  if (allMaPresent) {
    const maValues = [ma20, ma50, ma100, ma200];
    const maMax = Math.max(...maValues);
    const maMin = Math.min(...maValues);
    const maAvg = maValues.reduce((a, b) => a + b, 0) / maValues.length;
    maCompressionPct = maAvg !== 0 ? ((maMax - maMin) / maAvg) * 100 : null;
  }

  const rawClose = priceRows[priceRows.length - 1].close;
  const latestClose = rawClose != null ? Number(rawClose) : null;
  const disparityMa200Pct =
    ma200 != null && ma200 !== 0 && latestClose != null
      ? ((latestClose - ma200) / ma200) * 100
      : null;

  const maData = {
    symbol,
    date: targetDate,
    ma20: ma20?.toString() ?? null,
    ma50: ma50?.toString() ?? null,
    ma100: ma100?.toString() ?? null,
    ma200: ma200?.toString() ?? null,
    volMa30: volMa30?.toString() ?? null,
    maCompressionPct: maCompressionPct?.toFixed(4) ?? null,
    disparityMa200Pct: disparityMa200Pct?.toFixed(4) ?? null,
  };

  const validationResult = validateMovingAverageData(maData);
  if (!validationResult.isValid) {
    logger.warn(
      TAG,
      `MA data validation warnings for ${symbol}: ${JSON.stringify(validationResult.errors)}`,
    );
  }

  logger.info(
    TAG,
    `Calculated MA for ${symbol}: MA20=${ma20?.toFixed(2)}, MA50=${ma50?.toFixed(2)}, MA200=${ma200?.toFixed(2)}`,
  );

  return maData;
}

function calculateMA(
  prices: Record<string, unknown>[],
  period: number,
): number | null {
  if (prices.length < period) return null;

  const recentPrices = prices.slice(-period);
  const sum = recentPrices.reduce(
    (acc, p) => acc + Number(p.close),
    0,
  );
  return sum / period;
}

function calculateVolumeMA(
  prices: Record<string, unknown>[],
  period: number,
): number | null {
  if (prices.length < period) return null;

  const recentVolumes = prices.slice(-period);
  const sum = recentVolumes.reduce(
    (acc, p) => acc + Number(p.volume ?? 0),
    0,
  );
  return sum / period;
}

async function processBatch(symbols: string[], targetDate: string) {
  const results: string[] = [];
  const errors: { symbol: string; error: string }[] = [];

  for (const symbol of symbols) {
    try {
      const maData = await calculateMAForSymbol(symbol, targetDate);
      if (maData != null) {
        await retryDatabaseOperation(
          () =>
            db
              .insert(dailyMa)
              .values(maData)
              .onConflictDoUpdate({
                target: [dailyMa.symbol, dailyMa.date],
                set: {
                  ma20: maData.ma20,
                  ma50: maData.ma50,
                  ma100: maData.ma100,
                  ma200: maData.ma200,
                  volMa30: maData.volMa30,
                  maCompressionPct: maData.maCompressionPct,
                  disparityMa200Pct: maData.disparityMa200Pct,
                },
              }),
          DEFAULT_RETRY_OPTIONS,
        );

        results.push(symbol);
      }
    } catch (error) {
      logger.error(TAG, `Error processing ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ symbol, error: errorMessage });
    }

    await sleep(PAUSE_MS);
  }

  if (errors.length > 0) {
    logger.warn(
      TAG,
      `${errors.length} symbols failed: ${errors.map((e) => e.symbol).join(", ")}`,
    );
  }

  return results;
}

async function processDate(targetDate: string) {
  const startTime = Date.now();

  const result = await retryDatabaseOperation(
    () =>
      db.execute(sql`
      SELECT DISTINCT symbol
      FROM daily_prices
      WHERE date = ${targetDate}
      ORDER BY symbol
    `),
    DEFAULT_RETRY_OPTIONS,
  );

  const allSymbols = (result.rows as Record<string, unknown>[]).map(
    (r) => r.symbol as string,
  );
  logger.info(TAG, `Found ${allSymbols.length} symbols for date ${targetDate}`);

  if (allSymbols.length === 0) {
    logger.warn(TAG, `No symbols found for date ${targetDate}`);
    return;
  }

  let totalProcessed = 0;
  let totalErrors = 0;

  for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
    const batch = allSymbols.slice(i, i + BATCH_SIZE);
    logger.info(
      TAG,
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allSymbols.length / BATCH_SIZE)} (${batch.length} symbols)`,
    );

    const processed = await processBatch(batch, targetDate);
    totalProcessed += processed.length;
    totalErrors += batch.length - processed.length;
  }

  // 10거래일 압축도 이동평균 일괄 계산 — 종목별 추가 쿼리 없이 단일 UPDATE로 처리
  await retryDatabaseOperation(
    () =>
      db.execute(sql`
        WITH ranked AS (
          SELECT symbol, date, ma_compression_pct,
            ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) as rn
          FROM daily_ma
          WHERE date <= ${targetDate}
            AND date >= (${targetDate}::date - INTERVAL '30 days')
            AND ma_compression_pct IS NOT NULL
        )
        UPDATE daily_ma dm
        SET ma_compression_avg_10d = sub.avg_val
        FROM (
          SELECT symbol, ROUND(AVG(ma_compression_pct), 4) as avg_val
          FROM ranked
          WHERE rn <= 10
          GROUP BY symbol
        ) sub
        WHERE dm.symbol = sub.symbol
          AND dm.date = ${targetDate}
      `),
    DEFAULT_RETRY_OPTIONS,
  );
  logger.info(TAG, `Updated ma_compression_avg_10d for ${targetDate}`);

  const totalTime = Date.now() - startTime;
  logger.info(TAG, `Completed ${targetDate}: ${totalProcessed} ok, ${totalErrors} failed (${Math.round(totalTime / 1000)}s)`);
}

async function main() {
  logger.info(TAG, "Starting Daily MA ETL...");

  const envValidation = validateDatabaseOnlyEnvironment();
  if (!envValidation.isValid) {
    logger.error(TAG, `Environment validation failed: ${JSON.stringify(envValidation.errors)}`);
    process.exit(1);
  }

  const isBackfill = process.argv.slice(2).includes("backfill");

  if (isBackfill) {
    logger.info(TAG, "Backfill mode — calculating MA for last 30 days");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

    const result = await retryDatabaseOperation(
      () =>
        db.execute(sql`
        SELECT DISTINCT date
        FROM daily_prices
        WHERE date >= ${dateStr}
        ORDER BY date DESC
      `),
      DEFAULT_RETRY_OPTIONS,
    );

    const dates = (result.rows as Record<string, unknown>[]).map(
      (r) => r.date as string,
    );
    logger.info(TAG, `Found ${dates.length} dates to process`);

    for (const date of dates) {
      await processDate(date);
    }
  } else {
    const result = await retryDatabaseOperation(
      () =>
        db.execute(sql`SELECT MAX(date) as latest_date FROM daily_prices`),
      DEFAULT_RETRY_OPTIONS,
    );

    const targetDate = (result.rows as Record<string, unknown>[])[0]
      ?.latest_date as string | undefined;
    if (targetDate == null) {
      logger.error(TAG, "No price data found");
      return;
    }

    logger.info(TAG, `Processing latest date: ${targetDate}`);
    await processDate(targetDate);
  }
}

main()
  .then(async () => {
    logger.info(TAG, "Daily MA ETL completed successfully!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(TAG, `Daily MA ETL failed: ${error instanceof Error ? error.message : String(error)}`);
    await pool.end();
    process.exit(1);
  });

export { main as buildDailyMA };
