import { db } from "@/db/client";
import { sql } from "drizzle-orm";

interface DateRow {
  result_date?: string;
  [key: string]: unknown;
}

/**
 * Get the latest trade date that has complete analysis data
 * (daily_prices + stock_phases both populated).
 */
export async function getLatestTradeDate(): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT MAX(sp.date)::text AS result_date
    FROM stock_phases sp
    WHERE EXISTS (SELECT 1 FROM daily_prices dp WHERE dp.date = sp.date)
  `);
  const row = result.rows[0] as DateRow | undefined;
  return row?.result_date ?? null;
}

/**
 * Get the latest date that has price data (daily_prices only, no stock_phases join).
 * Used by market-analyst ETL jobs that run before stock_phases is built.
 *
 * Can be overridden via TARGET_DATE env var for backfill runs.
 */
export async function getLatestPriceDate(): Promise<string | null> {
  const override = process.env.TARGET_DATE;
  if (override != null && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return override;
  }

  const result = await db.execute(sql`
    SELECT MAX(date)::text AS result_date
    FROM daily_prices
  `);
  const row = result.rows[0] as DateRow | undefined;
  return row?.result_date ?? null;
}

/**
 * Get the trade date before the given date.
 */
export async function getPreviousTradeDate(
  currentDate: string,
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    throw new Error(`Invalid date format: ${currentDate}. Expected YYYY-MM-DD`);
  }

  const result = await db.execute(sql`
    SELECT MAX(date)::text AS result_date
    FROM daily_prices
    WHERE date < ${currentDate}
  `);
  const row = result.rows[0] as DateRow | undefined;
  return row?.result_date ?? null;
}

/**
 * Get the trade date N days back from the given date.
 * Returns the Nth most recent trade date before currentDate.
 */
export async function getTradeDate(
  currentDate: string,
  daysBack: number,
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    throw new Error(`Invalid date format: ${currentDate}. Expected YYYY-MM-DD`);
  }
  if (daysBack < 1) {
    throw new Error(`daysBack must be >= 1, got ${daysBack}`);
  }

  const result = await db.execute(sql`
    SELECT date::text AS result_date
    FROM (
      SELECT DISTINCT date FROM daily_prices
      WHERE date <= ${currentDate}
      ORDER BY date DESC
      LIMIT ${daysBack + 1}
    ) sub
    ORDER BY date ASC
    LIMIT 1
  `);
  const row = result.rows[0] as DateRow | undefined;
  return row?.result_date ?? null;
}
