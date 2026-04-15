import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { eq, sql } from "drizzle-orm";
import { fetchJson, sleep, toStrNum } from "@/etl/utils/common";
import { dailyPrices, symbols } from "@/db/schema/market";
import {
  validateEnvironmentVariables,
  validatePriceData,
  validateBatchData,
} from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { isWeekendDate } from "@/etl/utils/date-helpers";
import { logger } from "@/lib/logger";

const TAG = "LOAD_DAILY_PRICES";

const API = process.env.DATA_API!;
const KEY = process.env.FMP_API_KEY!;
const CONCURRENCY = 3;
const PAUSE_MS = 300;

const DEFAULT_DAYS = 5;
const BACKFILL_DAYS = 250;

async function loadOne(sym: string, N: number) {
  logger.info(TAG, `Loading prices for ${sym} (${N} days)`);

  const url = `${API}/api/v3/historical-price-full/${sym}?timeseries=${N}&apikey=${KEY}`;

  const j = await retryApiCall(
    () => fetchJson<{ historical?: Record<string, unknown>[] }>(url),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(TAG, `Failed to fetch prices for ${sym}: ${e instanceof Error ? e.message : String(e)}`);
    return { historical: [] as Record<string, unknown>[] };
  });

  const rows = j?.historical ?? [];
  if (rows.length === 0) {
    throw new Error(`No price data available for ${sym}`);
  }

  logger.info(TAG, `Found ${rows.length} price records for ${sym}`);

  const priceDataArray = rows.map((r) => ({
    symbol: sym,
    date: r.date as string,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));

  const validationResult = validateBatchData(
    priceDataArray as unknown as Record<string, unknown>[],
    validatePriceData,
  );
  if (!validationResult.isValid) {
    logger.warn(
      TAG,
      `Price data validation warnings for ${sym}: ${JSON.stringify(validationResult.errors.slice(0, 3))}`,
    );
  }

  const tradingDayRows = rows.filter((r) => !isWeekendDate(r.date as string));
  const weekendCount = rows.length - tradingDayRows.length;
  if (weekendCount > 0) {
    logger.warn(TAG, `Filtered ${weekendCount} weekend records for ${sym}`);
  }

  const batchSize = 50;
  for (let i = 0; i < tradingDayRows.length; i += batchSize) {
    const batch = tradingDayRows.slice(i, i + batchSize);

    const insertValues = batch.map((r) => ({
      symbol: sym,
      date: r.date as string,
      open: toStrNum(r.open),
      high: toStrNum(r.high),
      low: toStrNum(r.low),
      close: toStrNum(r.close),
      adjClose: toStrNum((r.adjClose ?? r.close) as unknown),
      volume: toStrNum(r.volume),
    }));

    await retryDatabaseOperation(
      () =>
        db
          .insert(dailyPrices)
          .values(insertValues)
          .onConflictDoUpdate({
            target: [dailyPrices.symbol, dailyPrices.date],
            set: {
              open: sql`EXCLUDED.open`,
              high: sql`EXCLUDED.high`,
              low: sql`EXCLUDED.low`,
              close: sql`EXCLUDED.close`,
              adjClose: sql`EXCLUDED.adj_close`,
              volume: sql`EXCLUDED.volume`,
            },
          }),
      DEFAULT_RETRY_OPTIONS,
    );
  }

  logger.info(TAG, `Loaded ${tradingDayRows.length} price records for ${sym}`);
}

async function main() {
  logger.info(TAG, "Starting Daily Prices ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(TAG, `Environment validation failed: ${JSON.stringify(envValidation.errors)}`);
    process.exit(1);
  }

  const isBackfill = process.argv.slice(2).includes("backfill");
  const daysToLoad = isBackfill ? BACKFILL_DAYS : DEFAULT_DAYS;

  logger.info(
    TAG,
    `Mode: ${isBackfill ? "BACKFILL" : "INCREMENTAL"} (${daysToLoad} days)`,
  );

  const activeSymbols = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.isActivelyTrading, true));

  const syms: string[] = activeSymbols.map((s) => s.symbol);

  if (syms.length === 0) {
    throw new Error("No active symbols found. Run 'symbols' job first.");
  }

  logger.info(TAG, `Processing ${syms.length} active symbols`);

  const limit = pLimit(CONCURRENCY);
  let ok = 0;
  let skip = 0;
  const startTime = Date.now();

  await Promise.all(
    syms.map((s) =>
      limit(async () => {
        try {
          await loadOne(s, daysToLoad);
          ok++;
          if (ok % 50 === 0) {
            logger.info(TAG, `Progress: ${ok}/${syms.length} (${s})`);
          }
        } catch (e: unknown) {
          skip++;
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(TAG, `Skipped ${s}: ${message}`);
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const totalTime = Date.now() - startTime;
  logger.info(TAG, `Daily Prices ETL completed! ${ok} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(TAG, `Daily Prices ETL failed: ${error instanceof Error ? error.message : String(error)}`);
    await pool.end();
    process.exit(1);
  });

export { main as loadDailyPrices };
