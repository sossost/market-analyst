import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { eq } from "drizzle-orm";
import { fetchJson, sleep, toStrNum } from "@/etl/utils/common";
import { dailyRatios, symbols } from "@/db/schema/market";
import { validateEnvironmentVariables } from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/agent/logger";

const TAG = "CALCULATE_DAILY_RATIOS";

const API = process.env.DATA_API!;
const KEY = process.env.FMP_API_KEY!;
const CONCURRENCY = 4;
const PAUSE_MS = 200;

interface RatiosTTM {
  peRatioTTM?: number;
  pegRatioTTM?: number;
  priceToSalesRatioTTM?: number;
  priceToBookRatioTTM?: number;
  enterpriseValueMultipleTTM?: number;
}

async function loadOne(symbol: string, targetDate: string) {
  const url = `${API}/api/v3/ratios-ttm/${symbol}?apikey=${KEY}`;

  const response: RatiosTTM[] = await retryApiCall(
    () => fetchJson<RatiosTTM[]>(url),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(TAG, `Failed to fetch TTM ratios for ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    return [] as RatiosTTM[];
  });

  if (response.length === 0) {
    throw new Error(`No TTM ratio data available for ${symbol}`);
  }

  const data = response[0];

  if (
    data.peRatioTTM == null &&
    data.priceToSalesRatioTTM == null &&
    data.priceToBookRatioTTM == null &&
    data.pegRatioTTM == null &&
    data.enterpriseValueMultipleTTM == null
  ) {
    throw new Error(`All TTM ratios are null for ${symbol}`);
  }

  const ratioData = {
    symbol,
    date: targetDate,
    peRatio: toStrNum(data.peRatioTTM),
    pegRatio: toStrNum(data.pegRatioTTM),
    psRatio: toStrNum(data.priceToSalesRatioTTM),
    pbRatio: toStrNum(data.priceToBookRatioTTM),
    evEbitda: toStrNum(data.enterpriseValueMultipleTTM),
    marketCap: null,
    epsTtm: null,
    revenueTtm: null,
  };

  await retryDatabaseOperation(
    () =>
      db
        .insert(dailyRatios)
        .values(ratioData)
        .onConflictDoUpdate({
          target: [dailyRatios.symbol, dailyRatios.date],
          set: {
            peRatio: ratioData.peRatio,
            pegRatio: ratioData.pegRatio,
            psRatio: ratioData.psRatio,
            pbRatio: ratioData.pbRatio,
            evEbitda: ratioData.evEbitda,
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function main() {
  logger.info(TAG, "Starting Daily Ratios ETL (FMP TTM API)...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(TAG, `Environment validation failed: ${JSON.stringify(envValidation.errors)}`);
    process.exit(1);
  }

  const today = new Date().toISOString().split("T")[0];
  logger.info(TAG, `Target date: ${today}`);

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
    syms.map((sym) =>
      limit(async () => {
        try {
          await loadOne(sym, today);
          ok++;
          if (ok % 100 === 0) {
            logger.info(TAG, `Progress: ${ok}/${syms.length}`);
          }
        } catch (e: unknown) {
          skip++;
          if (skip <= 10) {
            const message = e instanceof Error ? e.message : String(e);
            logger.warn(TAG, `Skipped ${sym}: ${message}`);
          }
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const totalTime = Date.now() - startTime;
  logger.info(TAG, `Daily Ratios ETL completed! ${ok} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(TAG, `Daily Ratios ETL failed: ${error instanceof Error ? error.message : String(error)}`);
    await pool.end();
    process.exit(1);
  });

export { main as calculateDailyRatios };
