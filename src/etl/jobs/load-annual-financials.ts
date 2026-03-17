import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, sleep } from "@/etl/utils/common";
import { annualFinancials } from "@/db/schema/analyst";
import {
  validateEnvironmentVariables,
} from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/agent/logger";

const TAG = "LOAD_ANNUAL_FINANCIALS";

const CONCURRENCY = 4;
const PAUSE_MS = 150;
const LIMIT_YEARS = 3;

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

interface FmpIncomeStatementRow {
  symbol?: string;
  date?: string; // "2024-09-30"
  calendarYear?: string | number; // "2024"
  revenue?: string | number;
  netIncome?: string | number;
  epsdiluted?: string | number;
  eps?: string | number;
  grossProfit?: string | number;
  operatingIncome?: string | number;
  ebitda?: string | number;
  freeCashFlow?: string | number;
}

function toStrNum(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

function extractFiscalYear(row: FmpIncomeStatementRow): string | null {
  if (row.calendarYear != null && String(row.calendarYear) !== "") {
    return String(row.calendarYear);
  }
  if (typeof row.date === "string" && row.date.length >= 4) {
    return row.date.substring(0, 4);
  }
  return null;
}

async function upsertAnnualFinancials(sym: string, row: FmpIncomeStatementRow) {
  const fiscalYear = extractFiscalYear(row);
  if (fiscalYear == null) {
    throw new Error(`Cannot determine fiscal year for ${sym}`);
  }

  const epsDiluted = toStrNum(row.epsdiluted ?? row.eps);

  await retryDatabaseOperation(
    () =>
      db
        .insert(annualFinancials)
        .values({
          symbol: sym,
          fiscalYear,
          revenue: toStrNum(row.revenue),
          netIncome: toStrNum(row.netIncome),
          epsDiluted,
          grossProfit: toStrNum(row.grossProfit),
          operatingIncome: toStrNum(row.operatingIncome),
          ebitda: toStrNum(row.ebitda),
          freeCashFlow: toStrNum(row.freeCashFlow),
        })
        .onConflictDoUpdate({
          target: [annualFinancials.symbol, annualFinancials.fiscalYear],
          set: {
            revenue: toStrNum(row.revenue),
            netIncome: toStrNum(row.netIncome),
            epsDiluted,
            grossProfit: toStrNum(row.grossProfit),
            operatingIncome: toStrNum(row.operatingIncome),
            ebitda: toStrNum(row.ebitda),
            freeCashFlow: toStrNum(row.freeCashFlow),
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function loadOne(symbol: string, api: string, key: string) {
  const rows = await retryApiCall(
    () =>
      fetchJson<FmpIncomeStatementRow[]>(
        `${api}/income-statement?symbol=${symbol}&period=annual&limit=${LIMIT_YEARS}&apikey=${key}`,
      ),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(
      TAG,
      `Failed to fetch annual financials for ${symbol}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [] as FmpIncomeStatementRow[];
  });

  if (rows.length === 0) {
    throw new Error(`No annual financial data available for ${symbol}`);
  }

  for (const row of rows) {
    await upsertAnnualFinancials(symbol, row);
  }

  logger.info(TAG, `Loaded ${rows.length} annual records for ${symbol}`);
}

async function fetchRecommendedSymbols(): Promise<string[]> {
  const rs = await db.execute(
    sql`SELECT DISTINCT symbol FROM recommendations WHERE status IN ('ACTIVE', 'CLOSED') ORDER BY symbol`,
  );
  return (rs.rows as Record<string, unknown>[]).map((r) => r.symbol as string);
}

async function main() {
  logger.info(TAG, "Starting Annual Financials ETL...");

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

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let skip = 0;
  const startTime = Date.now();

  await Promise.all(
    syms.map((sym) =>
      limit(async () => {
        try {
          await loadOne(sym, api, key);
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
    `Annual Financials ETL completed! ${done} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`,
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
      `Annual Financials ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadAnnualFinancials };
