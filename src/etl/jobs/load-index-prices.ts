import "dotenv/config";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, toStrNum } from "@/etl/utils/common";
import { indexPrices } from "@/db/schema/market";
import { validateEnvironmentVariables } from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "LOAD_INDEX_PRICES";

const API = process.env.DATA_API!;
const KEY = process.env.FMP_API_KEY!;

const DEFAULT_DAYS = 5;
const BACKFILL_DAYS = 250;

/**
 * FMP 심볼 매핑.
 * FMP는 지수 심볼에 %5E(^) prefix를 URL-encode하여 사용한다.
 */
const INDEX_SYMBOLS: ReadonlyArray<{ fmpSymbol: string; dbSymbol: string; name: string }> = [
  { fmpSymbol: "%5EGSPC", dbSymbol: "^GSPC", name: "S&P 500" },
  { fmpSymbol: "%5EIXIC", dbSymbol: "^IXIC", name: "NASDAQ" },
  { fmpSymbol: "%5EDJI", dbSymbol: "^DJI", name: "DOW 30" },
  { fmpSymbol: "%5ERUT", dbSymbol: "^RUT", name: "Russell 2000" },
  { fmpSymbol: "%5EVIX", dbSymbol: "^VIX", name: "VIX" },
];

interface FmpHistoricalRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function loadOne(fmpSymbol: string, dbSymbol: string, N: number) {
  logger.info(TAG, `Loading index prices for ${dbSymbol} (${N} days)`);

  const url = `${API}/api/v3/historical-price-full/${fmpSymbol}?timeseries=${N}&apikey=${KEY}`;

  const j = await retryApiCall(
    () => fetchJson<{ historical?: FmpHistoricalRow[] }>(url),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(
      TAG,
      `Failed to fetch index prices for ${dbSymbol}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { historical: [] as FmpHistoricalRow[] };
  });

  const rows = j?.historical ?? [];
  if (rows.length === 0) {
    throw new Error(`No index price data available for ${dbSymbol}`);
  }

  logger.info(TAG, `Found ${rows.length} index price records for ${dbSymbol}`);

  const insertValues = rows.map((r) => ({
    symbol: dbSymbol,
    date: r.date,
    open: toStrNum(r.open),
    high: toStrNum(r.high),
    low: toStrNum(r.low),
    close: toStrNum(r.close),
    volume: toStrNum(r.volume),
  }));

  await retryDatabaseOperation(
    () =>
      db
        .insert(indexPrices)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [indexPrices.symbol, indexPrices.date],
          set: {
            open: sql`EXCLUDED.open`,
            high: sql`EXCLUDED.high`,
            low: sql`EXCLUDED.low`,
            close: sql`EXCLUDED.close`,
            volume: sql`EXCLUDED.volume`,
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );

  logger.info(TAG, `Loaded ${rows.length} index price records for ${dbSymbol}`);
}

async function main() {
  logger.info(TAG, "Starting Index Prices ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(
      TAG,
      `Environment validation failed: ${JSON.stringify(envValidation.errors)}`,
    );
    process.exit(1);
  }

  const isBackfill = process.argv.slice(2).includes("backfill");
  const daysToLoad = isBackfill ? BACKFILL_DAYS : DEFAULT_DAYS;

  logger.info(
    TAG,
    `Mode: ${isBackfill ? "BACKFILL" : "INCREMENTAL"} (${daysToLoad} days)`,
  );

  let ok = 0;
  let skip = 0;

  for (const { fmpSymbol, dbSymbol } of INDEX_SYMBOLS) {
    try {
      await loadOne(fmpSymbol, dbSymbol, daysToLoad);
      ok++;
    } catch (e: unknown) {
      skip++;
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(TAG, `Skipped ${dbSymbol}: ${message}`);
    }
  }

  logger.info(
    TAG,
    `Index Prices ETL completed! ${ok} ok, ${skip} skipped`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(
      TAG,
      `Index Prices ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadIndexPrices };
