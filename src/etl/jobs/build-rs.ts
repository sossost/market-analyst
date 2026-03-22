import "dotenv/config";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { validateDatabaseOnlyEnvironment } from "@/etl/utils/validation";
import { logger } from "@/lib/logger";

const TAG = "BUILD_RS";

const BACKFILL_DAYS = 365;
const LOOKBACK_12M = 252;
const LOOKBACK_6M = 126;
const LOOKBACK_3M = 63;

const WEIGHT_12M = 0.2;
const WEIGHT_6M = 0.3;
const WEIGHT_3M = 0.5;

async function computeRsForDate(targetDate: string) {
  logger.info(TAG, `Computing RS for ${targetDate}...`);

  try {
    const targetDateObj = new Date(targetDate);
    const date12m = new Date(targetDateObj);
    date12m.setDate(date12m.getDate() - LOOKBACK_12M);
    const date12mStr = date12m.toISOString().split("T")[0];

    const date6m = new Date(targetDateObj);
    date6m.setDate(date6m.getDate() - LOOKBACK_6M);
    const date6mStr = date6m.toISOString().split("T")[0];

    const date3m = new Date(targetDateObj);
    date3m.setDate(date3m.getDate() - LOOKBACK_3M);
    const date3mStr = date3m.toISOString().split("T")[0];

    const result = (await db.execute(sql`
      WITH target AS (
        SELECT ${targetDate}::date AS d
      ),
      latest AS (
        SELECT
          dp.symbol,
          dp.adj_close::numeric AS last_close,
          (
            SELECT dp2.adj_close::numeric
            FROM daily_prices dp2
            JOIN target t2 ON dp2.date::date <= ${date12mStr}::date
            WHERE dp2.symbol = dp.symbol
            ORDER BY dp2.date DESC
            LIMIT 1
          ) AS lag_12m,
          (
            SELECT dp2.adj_close::numeric
            FROM daily_prices dp2
            JOIN target t2 ON dp2.date::date <= ${date6mStr}::date
            WHERE dp2.symbol = dp.symbol
            ORDER BY dp2.date DESC
            LIMIT 1
          ) AS lag_6m,
          (
            SELECT dp2.adj_close::numeric
            FROM daily_prices dp2
            JOIN target t2 ON dp2.date::date <= ${date3mStr}::date
            WHERE dp2.symbol = dp.symbol
            ORDER BY dp2.date DESC
            LIMIT 1
          ) AS lag_3m
        FROM daily_prices dp
        JOIN target t ON dp.date::date = t.d
      ),
      returns AS (
        SELECT
          symbol,
          CASE WHEN lag_12m IS NULL OR lag_12m = 0 THEN NULL ELSE (last_close / lag_12m) - 1 END AS ret_12m,
          CASE WHEN lag_6m IS NULL OR lag_6m = 0 THEN NULL ELSE (last_close / lag_6m) - 1 END AS ret_6m,
          CASE WHEN lag_3m IS NULL OR lag_3m = 0 THEN NULL ELSE (last_close / lag_3m) - 1 END AS ret_3m
        FROM latest
      ),
      r12 AS (
        SELECT symbol, percent_rank() OVER (ORDER BY ret_12m) AS pr12
        FROM returns
        WHERE ret_12m IS NOT NULL
      ),
      r6 AS (
        SELECT symbol, percent_rank() OVER (ORDER BY ret_6m) AS pr6
        FROM returns
        WHERE ret_6m IS NOT NULL
      ),
      r3 AS (
        SELECT symbol, percent_rank() OVER (ORDER BY ret_3m) AS pr3
        FROM returns
        WHERE ret_3m IS NOT NULL
      ),
      combined AS (
        SELECT
          rt.symbol,
          CASE
            WHEN r12.pr12 IS NULL OR r6.pr6 IS NULL OR r3.pr3 IS NULL THEN NULL
            ELSE ROUND((r12.pr12 * ${WEIGHT_12M} + r6.pr6 * ${WEIGHT_6M} + r3.pr3 * ${WEIGHT_3M}) * 100)::int
          END AS rs_score
        FROM returns rt
        LEFT JOIN r12 ON r12.symbol = rt.symbol
        LEFT JOIN r6 ON r6.symbol = rt.symbol
        LEFT JOIN r3 ON r3.symbol = rt.symbol
      ),
      updated AS (
        UPDATE daily_prices dp
        SET rs_score = c.rs_score
        FROM combined c
        JOIN target t ON true
        WHERE dp.symbol = c.symbol
          AND dp.date::date = t.d
        RETURNING dp.symbol, dp.rs_score
      )
      SELECT COUNT(*) AS updated_count FROM updated;
    `)) as { rows: { updated_count: number }[] };

    const updatedCount = result.rows?.[0]?.updated_count ?? 0;
    logger.info(
      TAG,
      `RS computed for ${targetDate} (rows updated: ${updatedCount})`,
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(TAG, `Failed to compute RS for ${targetDate}: ${message}`);
    throw e;
  }
}

async function main() {
  logger.info(TAG, "Starting RS build...");

  const envValidation = validateDatabaseOnlyEnvironment();
  if (!envValidation.isValid) {
    logger.error(TAG, `Environment validation failed: ${JSON.stringify(envValidation.errors)}`);
    process.exit(1);
  }

  const isBackfill = process.argv.slice(2).includes("backfill");

  const dateRows = isBackfill
    ? await db.execute(sql`
        SELECT DISTINCT date::date AS d
        FROM daily_prices
        ORDER BY d DESC
        LIMIT ${BACKFILL_DAYS};
      `)
    : await db.execute(sql`
        SELECT MAX(date)::date AS d
        FROM daily_prices;
      `);

  const dates: string[] = (dateRows.rows as Record<string, unknown>[])
    .map((r) => (r.d ?? r.date ?? r.max) as string)
    .filter(Boolean);

  if (dates.length === 0) {
    logger.warn(TAG, "No dates found in daily_prices; aborting.");
    return;
  }

  for (const d of dates) {
    try {
      await computeRsForDate(d);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(TAG, `Failed to compute RS for ${d}: ${message}`);
    }
  }

  logger.info(TAG, "RS build finished.");
}

main().catch((err) => {
  logger.error(TAG, `RS build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
