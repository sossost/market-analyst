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

const BATCH_SIZE = 100;
const PAUSE_MS = 50;

async function calculateMAForSymbol(symbol: string, targetDate: string) {
  console.log(`📊 Calculating MA for ${symbol} on ${targetDate}`);

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
    console.log(
      `⚠️ Insufficient data for ${symbol}: ${priceRows.length} days (need 200+)`,
    );
    return null;
  }

  const ma20 = calculateMA(priceRows, 20);
  const ma50 = calculateMA(priceRows, 50);
  const ma100 = calculateMA(priceRows, 100);
  const ma200 = calculateMA(priceRows, 200);
  const volMa30 = calculateVolumeMA(priceRows, 30);

  const maData = {
    symbol,
    date: targetDate,
    ma20: ma20?.toString() ?? null,
    ma50: ma50?.toString() ?? null,
    ma100: ma100?.toString() ?? null,
    ma200: ma200?.toString() ?? null,
    volMa30: volMa30?.toString() ?? null,
  };

  const validationResult = validateMovingAverageData(maData);
  if (!validationResult.isValid) {
    console.warn(
      `⚠️ MA data validation warnings for ${symbol}:`,
      validationResult.errors,
    );
  }

  console.log(
    `✅ Calculated MA for ${symbol}: MA20=${ma20?.toFixed(2)}, MA50=${ma50?.toFixed(2)}, MA200=${ma200?.toFixed(2)}`,
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
                },
              }),
          DEFAULT_RETRY_OPTIONS,
        );

        results.push(symbol);
      }
    } catch (error) {
      console.error(`❌ Error processing ${symbol}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push({ symbol, error: errorMessage });
    }

    await sleep(PAUSE_MS);
  }

  if (errors.length > 0) {
    console.warn(
      `⚠️ ${errors.length} symbols failed:`,
      errors.map((e) => e.symbol),
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
  console.log(`📊 Found ${allSymbols.length} symbols for date ${targetDate}`);

  if (allSymbols.length === 0) {
    console.warn(`⚠️ No symbols found for date ${targetDate}`);
    return;
  }

  let totalProcessed = 0;
  let totalErrors = 0;

  for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
    const batch = allSymbols.slice(i, i + BATCH_SIZE);
    console.log(
      `📊 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allSymbols.length / BATCH_SIZE)} (${batch.length} symbols)`,
    );

    const processed = await processBatch(batch, targetDate);
    totalProcessed += processed.length;
    totalErrors += batch.length - processed.length;
  }

  const totalTime = Date.now() - startTime;
  console.log(`✅ Completed ${targetDate}: ${totalProcessed} ok, ${totalErrors} failed (${Math.round(totalTime / 1000)}s)`);
}

async function main() {
  console.log("🚀 Starting Daily MA ETL...");

  const envValidation = validateDatabaseOnlyEnvironment();
  if (!envValidation.isValid) {
    console.error("❌ Environment validation failed:", envValidation.errors);
    process.exit(1);
  }

  const isBackfill = process.argv.slice(2).includes("backfill");

  if (isBackfill) {
    console.log("📊 Backfill mode — calculating MA for last 30 days");

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
    console.log(`📅 Found ${dates.length} dates to process`);

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
      console.error("❌ No price data found");
      return;
    }

    console.log(`📊 Processing latest date: ${targetDate}`);
    await processDate(targetDate);
  }
}

main()
  .then(async () => {
    console.log("✅ Daily MA ETL completed successfully!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Daily MA ETL failed:", error);
    await pool.end();
    process.exit(1);
  });

export { main as buildDailyMA };
