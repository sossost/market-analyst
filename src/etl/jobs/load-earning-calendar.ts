import "dotenv/config";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, toStrNum } from "@/etl/utils/common";
import { earningCalendar } from "@/db/schema/analyst";
import { validateEnvironmentVariables } from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "LOAD_EARNING_CALENDAR";

const DAYS_PAST = 7;
const DAYS_FUTURE = 30;

function getApiConfig(): { baseUrl: string; key: string } {
  const dataApi = process.env.DATA_API;
  const fmpKey = process.env.FMP_API_KEY;
  if (dataApi == null || dataApi === "") {
    throw new Error("Missing required environment variable: DATA_API");
  }
  if (fmpKey == null || fmpKey === "") {
    throw new Error("Missing required environment variable: FMP_API_KEY");
  }
  return { baseUrl: dataApi, key: fmpKey };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface FmpEarningCalendarRow {
  symbol?: string;
  date?: string; // YYYY-MM-DD
  eps?: string | number | null;
  epsEstimated?: string | number | null;
  revenue?: string | number | null;
  revenueEstimated?: string | number | null;
  time?: string | null; // 'amc' | 'bmo'
}

/**
 * Phase 2 + watchlist ACTIVE 종목 심볼 SET 로드.
 * earning_calendar 필터링에 사용.
 */
async function fetchTargetSymbolSet(): Promise<Set<string>> {
  const result = await db.execute(sql`
    SELECT DISTINCT symbol FROM (
      SELECT symbol
      FROM stock_phases
      WHERE date = (SELECT MAX(date) FROM stock_phases)
        AND phase = 2
      UNION
      SELECT symbol
      FROM watchlist_stocks
      WHERE status = 'ACTIVE'
    ) t
  `);

  const symbols = (result.rows as Record<string, unknown>[]).map(
    (r) => r.symbol as string,
  );
  return new Set(symbols);
}

async function fetchEarningCalendar(
  baseUrl: string,
  key: string,
  fromDate: string,
  toDate: string,
): Promise<FmpEarningCalendarRow[]> {
  const url = `${baseUrl}/api/v3/earning_calendar?from=${fromDate}&to=${toDate}&apikey=${key}`;
  return retryApiCall(
    () => fetchJson<FmpEarningCalendarRow[]>(url),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function upsertEarningCalendar(
  rows: FmpEarningCalendarRow[],
  symbolSet: Set<string>,
): Promise<number> {
  const filteredRows = rows.filter(
    (r) =>
      r.symbol != null &&
      r.symbol !== "" &&
      r.date != null &&
      r.date !== "" &&
      symbolSet.has(r.symbol),
  );

  if (filteredRows.length === 0) {
    return 0;
  }

  const insertValues = filteredRows.map((r) => ({
    symbol: r.symbol as string,
    date: r.date as string,
    eps: r.eps != null ? toStrNum(r.eps) : null,
    epsEstimated: r.epsEstimated != null ? toStrNum(r.epsEstimated) : null,
    revenue: r.revenue != null ? toStrNum(r.revenue) : null,
    revenueEstimated: r.revenueEstimated != null ? toStrNum(r.revenueEstimated) : null,
    time: r.time ?? null,
  }));

  await retryDatabaseOperation(
    () =>
      db
        .insert(earningCalendar)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [earningCalendar.symbol, earningCalendar.date],
          set: {
            eps: sql`EXCLUDED.eps`,
            epsEstimated: sql`EXCLUDED.eps_estimated`,
            revenue: sql`EXCLUDED.revenue`,
            revenueEstimated: sql`EXCLUDED.revenue_estimated`,
            time: sql`EXCLUDED.time`,
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );

  return filteredRows.length;
}

async function main() {
  logger.info(TAG, "Starting Earning Calendar ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(
      TAG,
      `Environment validation failed: ${JSON.stringify(envValidation.errors)}`,
    );
    process.exit(1);
  }

  const { baseUrl, key } = getApiConfig();

  const today = new Date();
  const fromDate = toDateString(
    new Date(today.getTime() - DAYS_PAST * 24 * 60 * 60 * 1000),
  );
  const toDate = toDateString(
    new Date(today.getTime() + DAYS_FUTURE * 24 * 60 * 60 * 1000),
  );

  logger.info(TAG, `Fetching earning calendar: ${fromDate} ~ ${toDate}`);

  const [symbolSet, calendarRows] = await Promise.all([
    fetchTargetSymbolSet(),
    fetchEarningCalendar(baseUrl, key, fromDate, toDate),
  ]);

  logger.info(
    TAG,
    `Fetched ${calendarRows.length} calendar entries, ${symbolSet.size} target symbols`,
  );

  const upserted = await upsertEarningCalendar(calendarRows, symbolSet);

  logger.info(
    TAG,
    `Earning Calendar ETL completed! ${upserted} rows upserted (filtered from ${calendarRows.length} total)`,
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
      `Earning Calendar ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadEarningCalendar };
