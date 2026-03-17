import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, sleep } from "@/etl/utils/common";
import { analystEstimates, epsSurprises } from "@/db/schema/analyst";
import {
  validateEnvironmentVariables,
} from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/agent/logger";

const TAG = "LOAD_ANALYST_ESTIMATES";

const CONCURRENCY = 4;
const PAUSE_MS = 150;
const LIMIT_QUARTERS = 4;

function getApiConfig(): { api: string; key: string } {
  const dataApi = process.env.DATA_API;
  const fmpKey = process.env.FMP_API_KEY;
  if (dataApi == null || dataApi === "") {
    throw new Error("Missing required environment variable: DATA_API");
  }
  if (fmpKey == null || fmpKey === "") {
    throw new Error("Missing required environment variable: FMP_API_KEY");
  }
  return { api: `${dataApi}/stable`, key: fmpKey };
}

interface FmpAnalystEstimateRow {
  symbol?: string;
  date?: string; // "2026-03-31" — 분기말 날짜
  estimatedEpsAvg?: string | number;
  estimatedEpsHigh?: string | number;
  estimatedEpsLow?: string | number;
  estimatedRevenueAvg?: string | number;
  numberAnalystEstimatedEps?: string | number;
}

interface FmpEpsSurpriseBulkRow {
  symbol?: string;
  date?: string; // "2024-10-31" — 어닝 발표일
  epsActual?: string | number;
  epsEstimated?: string | number;
  lastUpdated?: string;
}

function toStrNum(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

async function upsertEstimate(sym: string, row: FmpAnalystEstimateRow) {
  const period = row.date;
  if (period == null || period === "") {
    throw new Error(`Missing period date for ${sym}`);
  }

  await retryDatabaseOperation(
    () =>
      db
        .insert(analystEstimates)
        .values({
          symbol: sym,
          period,
          estimatedEpsAvg: toStrNum(row.estimatedEpsAvg),
          estimatedEpsHigh: toStrNum(row.estimatedEpsHigh),
          estimatedEpsLow: toStrNum(row.estimatedEpsLow),
          estimatedRevenueAvg: toStrNum(row.estimatedRevenueAvg),
          numberAnalystEstimatedEps:
            row.numberAnalystEstimatedEps != null
              ? (Number.isFinite(Number(row.numberAnalystEstimatedEps))
                  ? Number(row.numberAnalystEstimatedEps)
                  : null)
              : null,
        })
        .onConflictDoUpdate({
          target: [analystEstimates.symbol, analystEstimates.period],
          set: {
            estimatedEpsAvg: toStrNum(row.estimatedEpsAvg),
            estimatedEpsHigh: toStrNum(row.estimatedEpsHigh),
            estimatedEpsLow: toStrNum(row.estimatedEpsLow),
            estimatedRevenueAvg: toStrNum(row.estimatedRevenueAvg),
            numberAnalystEstimatedEps:
              row.numberAnalystEstimatedEps != null
                ? (Number.isFinite(Number(row.numberAnalystEstimatedEps))
                    ? Number(row.numberAnalystEstimatedEps)
                    : null)
                : null,
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function upsertEpsSurprise(sym: string, row: FmpEpsSurpriseBulkRow) {
  const actualDate = row.date;
  if (actualDate == null || actualDate === "") {
    throw new Error(`Missing date for EPS surprise — ${sym}`);
  }

  await retryDatabaseOperation(
    () =>
      db
        .insert(epsSurprises)
        .values({
          symbol: sym,
          actualDate,
          actualEps: toStrNum(row.epsActual),
          estimatedEps: toStrNum(row.epsEstimated),
        })
        .onConflictDoUpdate({
          target: [epsSurprises.symbol, epsSurprises.actualDate],
          set: {
            actualEps: toStrNum(row.epsActual),
            estimatedEps: toStrNum(row.epsEstimated),
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function fetchBulkEpsSurprises(
  api: string,
  key: string,
  symbolSet: Set<string>,
): Promise<Map<string, FmpEpsSurpriseBulkRow[]>> {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear];

  const allRows: FmpEpsSurpriseBulkRow[] = [];

  for (const year of years) {
    const rows = await retryApiCall(
      () =>
        fetchJson<FmpEpsSurpriseBulkRow[]>(
          `${api}/earnings-surprises-bulk?year=${year}&apikey=${key}`,
        ),
      DEFAULT_RETRY_OPTIONS,
    ).catch((e) => {
      logger.error(
        TAG,
        `Failed to fetch bulk EPS surprises for year ${year}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [] as FmpEpsSurpriseBulkRow[];
    });

    allRows.push(...rows.filter((r) => r.symbol != null && symbolSet.has(r.symbol)));
  }

  // symbol별로 그룹핑
  const bySymbol = new Map<string, FmpEpsSurpriseBulkRow[]>();
  for (const row of allRows) {
    const sym = row.symbol as string;
    const existing = bySymbol.get(sym) ?? [];
    existing.push(row);
    bySymbol.set(sym, existing);
  }

  return bySymbol;
}

async function loadOne(
  symbol: string,
  api: string,
  key: string,
  bulkSurprises: Map<string, FmpEpsSurpriseBulkRow[]>,
) {
  const estimateRows = await retryApiCall(
    () =>
      fetchJson<FmpAnalystEstimateRow[]>(
        `${api}/analyst-estimates?symbol=${symbol}&period=quarterly&limit=${LIMIT_QUARTERS}&apikey=${key}`,
      ),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(
      TAG,
      `Failed to fetch analyst estimates for ${symbol}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [] as FmpAnalystEstimateRow[];
  });

  const surpriseRows = bulkSurprises.get(symbol) ?? [];

  if (estimateRows.length === 0 && surpriseRows.length === 0) {
    throw new Error(`No analyst estimate or EPS surprise data available for ${symbol}`);
  }

  for (const row of estimateRows) {
    await upsertEstimate(symbol, row);
  }

  for (const row of surpriseRows) {
    await upsertEpsSurprise(symbol, row);
  }

  logger.info(
    TAG,
    `Loaded ${estimateRows.length} estimates + ${surpriseRows.length} surprises for ${symbol}`,
  );
}

async function fetchRecommendedSymbols(): Promise<string[]> {
  const rs = await db.execute(
    sql`SELECT DISTINCT symbol FROM recommendations WHERE status IN ('ACTIVE', 'CLOSED') ORDER BY symbol`,
  );
  return (rs.rows as Record<string, unknown>[]).map((r) => r.symbol as string);
}

async function main() {
  logger.info(TAG, "Starting Analyst Estimates ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(
      TAG,
      `Environment validation failed: ${JSON.stringify(envValidation.errors)}`,
    );
    process.exit(1);
  }

  const { api, key } = getApiConfig();

  const syms = await fetchRecommendedSymbols();

  if (syms.length === 0) {
    logger.warn(TAG, "No recommended symbols found. Skipping.");
    return;
  }

  logger.info(TAG, `Processing ${syms.length} recommended symbols`);

  // Bulk EPS surprises를 미리 가져옴 (종목별 호출 대신 연도별 bulk 2회)
  const symbolSet = new Set(syms);
  const bulkSurprises = await fetchBulkEpsSurprises(api, key, symbolSet);
  logger.info(TAG, `Fetched bulk EPS surprises for ${bulkSurprises.size} symbols`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let skip = 0;
  const startTime = Date.now();

  await Promise.all(
    syms.map((sym) =>
      limit(async () => {
        try {
          await loadOne(sym, api, key, bulkSurprises);
          done++;
          if (done % 50 === 0) {
            logger.info(TAG, `Progress: ${done}/${syms.length} (${sym})`);
          }
        } catch (e: unknown) {
          skip++;
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(TAG, `Skipped ${sym}: ${message}`);
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const totalTime = Date.now() - startTime;
  logger.info(
    TAG,
    `Analyst Estimates ETL completed! ${done} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`,
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
      `Analyst Estimates ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadAnalystEstimates };
