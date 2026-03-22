import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, sleep } from "@/etl/utils/common";
import { companyProfiles } from "@/db/schema/analyst";
import {
  validateEnvironmentVariables,
} from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "LOAD_COMPANY_PROFILES";

const CONCURRENCY = 4;
const PAUSE_MS = 150;

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

interface FmpProfileRow {
  symbol?: string;
  companyName?: string;
  description?: string;
  ceo?: string;
  fullTimeEmployees?: string | number;
  mktCap?: string | number;
  sector?: string;
  industry?: string;
  website?: string;
  country?: string;
  exchangeShortName?: string;
  ipoDate?: string;
}

async function upsertProfile(sym: string, row: FmpProfileRow) {
  const employees =
    row.fullTimeEmployees != null && row.fullTimeEmployees !== ""
      ? Number(row.fullTimeEmployees)
      : null;
  const marketCap =
    row.mktCap != null && row.mktCap !== "" ? String(row.mktCap) : null;

  await retryDatabaseOperation(
    () =>
      db
        .insert(companyProfiles)
        .values({
          symbol: sym,
          companyName: row.companyName ?? null,
          description: row.description ?? null,
          ceo: row.ceo ?? null,
          employees: Number.isFinite(employees) ? employees : null,
          marketCap,
          sector: row.sector ?? null,
          industry: row.industry ?? null,
          website: row.website ?? null,
          country: row.country ?? null,
          exchange: row.exchangeShortName ?? null,
          ipoDate: row.ipoDate ?? null,
        })
        .onConflictDoUpdate({
          target: companyProfiles.symbol,
          set: {
            companyName: row.companyName ?? null,
            description: row.description ?? null,
            ceo: row.ceo ?? null,
            employees: Number.isFinite(employees) ? employees : null,
            marketCap,
            sector: row.sector ?? null,
            industry: row.industry ?? null,
            website: row.website ?? null,
            country: row.country ?? null,
            exchange: row.exchangeShortName ?? null,
            ipoDate: row.ipoDate ?? null,
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function loadOne(symbol: string, api: string, key: string) {
  const rows = await retryApiCall(
    () =>
      fetchJson<FmpProfileRow[]>(
        `${api}/profile?symbol=${symbol}&apikey=${key}`,
      ),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(
      TAG,
      `Failed to fetch profile for ${symbol}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [] as FmpProfileRow[];
  });

  if (rows.length === 0) {
    throw new Error(`No profile data available for ${symbol}`);
  }

  await upsertProfile(symbol, rows[0]);
}

async function fetchRecommendedSymbols(): Promise<string[]> {
  const rs = await db.execute(
    sql`SELECT DISTINCT symbol FROM recommendations WHERE status IN ('ACTIVE', 'CLOSED') ORDER BY symbol`,
  );
  return (rs.rows as Record<string, unknown>[]).map((r) => r.symbol as string);
}

async function main() {
  logger.info(TAG, "Starting Company Profiles ETL...");

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
    `Company Profiles ETL completed! ${done} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`,
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
      `Company Profiles ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadCompanyProfiles };
