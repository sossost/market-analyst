import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { eq } from "drizzle-orm";
import { fetchJson, sleep, toStrNum } from "@/etl/utils/common";
import { dailyPrices, symbols } from "@/db/schema/screener";
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

const API = process.env.DATA_API!;
const KEY = process.env.FMP_API_KEY!;
const CONCURRENCY = 3;
const PAUSE_MS = 300;

const DEFAULT_DAYS = 5;
const BACKFILL_DAYS = 250;

async function loadOne(sym: string, N: number) {
  console.log(`📊 Loading prices for ${sym} (${N} days)`);

  const url = `${API}/api/v3/historical-price-full/${sym}?timeseries=${N}&apikey=${KEY}`;

  const j = await retryApiCall(
    () => fetchJson<{ historical?: Record<string, unknown>[] }>(url),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    console.error(`❌ Failed to fetch prices for ${sym}:`, e);
    return { historical: [] as Record<string, unknown>[] };
  });

  const rows = j?.historical ?? [];
  if (rows.length === 0) {
    throw new Error(`No price data available for ${sym}`);
  }

  console.log(`📈 Found ${rows.length} price records for ${sym}`);

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
    console.warn(
      `⚠️ Price data validation warnings for ${sym}:`,
      validationResult.errors.slice(0, 3),
    );
  }

  const batchSize = 10;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const r of batch) {
      await retryDatabaseOperation(
        () =>
          db
            .insert(dailyPrices)
            .values({
              symbol: sym,
              date: r.date as string,
              open: toStrNum(r.open),
              high: toStrNum(r.high),
              low: toStrNum(r.low),
              close: toStrNum(r.close),
              adjClose: toStrNum((r.adjClose ?? r.close) as unknown),
              volume: toStrNum(r.volume),
            })
            .onConflictDoUpdate({
              target: [dailyPrices.symbol, dailyPrices.date],
              set: {
                open: toStrNum(r.open),
                high: toStrNum(r.high),
                low: toStrNum(r.low),
                close: toStrNum(r.close),
                adjClose: toStrNum((r.adjClose ?? r.close) as unknown),
                volume: toStrNum(r.volume),
              },
            }),
        DEFAULT_RETRY_OPTIONS,
      );
    }
  }

  console.log(`✅ Loaded ${rows.length} price records for ${sym}`);
}

async function main() {
  console.log("🚀 Starting Daily Prices ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    console.error("❌ Environment validation failed:", envValidation.errors);
    process.exit(1);
  }

  const isBackfill = process.argv.slice(2).includes("backfill");
  const daysToLoad = isBackfill ? BACKFILL_DAYS : DEFAULT_DAYS;

  console.log(
    `📊 Mode: ${isBackfill ? "BACKFILL" : "INCREMENTAL"} (${daysToLoad} days)`,
  );

  const activeSymbols = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.isActivelyTrading, true));

  const syms: string[] = activeSymbols.map((s) => s.symbol);

  if (syms.length === 0) {
    throw new Error("No active symbols found. Run 'symbols' job first.");
  }

  console.log(`📊 Processing ${syms.length} active symbols`);

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
            console.log(`📊 Progress: ${ok}/${syms.length} (${s})`);
          }
        } catch (e: unknown) {
          skip++;
          const message = e instanceof Error ? e.message : String(e);
          console.warn(`⚠️ Skipped ${s}: ${message}`);
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const totalTime = Date.now() - startTime;
  console.log(`✅ Daily Prices ETL completed! ${ok} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Daily Prices ETL failed:", error);
    await pool.end();
    process.exit(1);
  });

export { main as loadDailyPrices };
