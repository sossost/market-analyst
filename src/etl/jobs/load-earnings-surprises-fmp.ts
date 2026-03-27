import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, getFmpV3Config, sleep, toStrNum } from "@/etl/utils/common";
import { epsSurprises } from "@/db/schema/analyst";
import { validateEnvironmentVariables } from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "LOAD_EARNINGS_SURPRISES_FMP";

const CONCURRENCY = 8;
const PAUSE_MS = 100;
const LIMIT_QUARTERS = 4;
const MIN_RS_SCORE = 70;
const MIN_VOL_RATIO = 1.5;


interface FmpEarningsSurpriseRow {
  symbol?: string;
  date?: string; // 어닝 발표일 (YYYY-MM-DD)
  actualEarningResult?: string | number | null;
  estimatedEarning?: string | number | null;
}

/**
 * 대상 종목 조회: Phase 2 (RS>=70 OR vol_ratio>=1.5) + watchlist ACTIVE.
 * load-stock-news와 동일 대상.
 */
async function fetchTargetSymbols(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT symbol FROM (
      SELECT sp.symbol
      FROM stock_phases sp
      WHERE sp.date = (SELECT MAX(date) FROM stock_phases)
        AND sp.phase = 2
        AND (
          sp.rs_score >= ${MIN_RS_SCORE}
          OR (sp.vol_ratio IS NOT NULL AND CAST(sp.vol_ratio AS float) >= ${MIN_VOL_RATIO})
        )
      UNION
      SELECT symbol
      FROM watchlist_stocks
      WHERE status = 'ACTIVE'
    ) t
    ORDER BY symbol
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => r.symbol as string);
}

async function fetchSurprisesForSymbol(
  symbol: string,
  baseUrl: string,
  key: string,
): Promise<FmpEarningsSurpriseRow[]> {
  const url = `${baseUrl}/api/v3/earnings-surprises/${symbol}?apikey=${key}`;
  const rows = await retryApiCall(
    () => fetchJson<FmpEarningsSurpriseRow[]>(url),
    DEFAULT_RETRY_OPTIONS,
  );
  // 최근 N 분기만 처리
  return rows.slice(0, LIMIT_QUARTERS);
}

async function upsertSurprises(
  symbol: string,
  rows: FmpEarningsSurpriseRow[],
): Promise<number> {
  const validRows = rows.filter((r) => r.date != null && r.date !== "");

  if (validRows.length === 0) {
    return 0;
  }

  const insertValues = validRows.map((r) => ({
    symbol,
    actualDate: r.date as string,
    actualEps: r.actualEarningResult != null ? toStrNum(r.actualEarningResult) : null,
    estimatedEps: r.estimatedEarning != null ? toStrNum(r.estimatedEarning) : null,
  }));

  await retryDatabaseOperation(
    () =>
      db
        .insert(epsSurprises)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [epsSurprises.symbol, epsSurprises.actualDate],
          set: {
            actualEps: sql`EXCLUDED.actual_eps`,
            estimatedEps: sql`EXCLUDED.estimated_eps`,
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );

  return insertValues.length;
}

async function main() {
  logger.info(TAG, "Starting Earnings Surprises FMP ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(
      TAG,
      `Environment validation failed: ${JSON.stringify(envValidation.errors)}`,
    );
    process.exit(1);
  }

  const { baseUrl, key } = getFmpV3Config();

  const symbols = await fetchTargetSymbols();

  if (symbols.length === 0) {
    logger.warn(TAG, "No target symbols found. Skipping.");
    return;
  }

  logger.info(
    TAG,
    `Processing ${symbols.length} symbols (Phase 2 RS>=${MIN_RS_SCORE}/vol>=${MIN_VOL_RATIO} + watchlist ACTIVE)`,
  );

  const limit = pLimit(CONCURRENCY);
  const startTime = Date.now();

  const results = await Promise.all(
    symbols.map((symbol) =>
      limit(async () => {
        try {
          const rows = await fetchSurprisesForSymbol(symbol, baseUrl, key);
          const upserted = await upsertSurprises(symbol, rows);
          return { ok: true, upserted } as const;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(TAG, `Skipped ${symbol}: ${message}`);
          return { ok: false, upserted: 0 } as const;
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const done = results.filter((r) => r.ok).length;
  const skip = results.filter((r) => !r.ok).length;
  const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0);

  const totalTime = Date.now() - startTime;
  logger.info(
    TAG,
    `Earnings Surprises FMP ETL completed! ${done} ok, ${skip} skipped, ${totalUpserted} rows upserted (${Math.round(totalTime / 1000)}s)`,
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
      `Earnings Surprises FMP ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadEarningsSurprisesFmp };
