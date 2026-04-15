import { db } from "@/db/client";
import { sql } from "drizzle-orm";

const SATURDAY = 6;
const SUNDAY = 0;

interface DateRow {
  result_date?: string;
  [key: string]: unknown;
}

/**
 * Check if a date string (YYYY-MM-DD) falls on a weekend (Saturday or Sunday).
 * Uses UTC to avoid local timezone issues.
 */
export function isWeekendDate(dateStr: string): boolean {
  const day = new Date(dateStr).getUTCDay();
  return day === SATURDAY || day === SUNDAY;
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
      AND EXTRACT(DOW FROM sp.date::date) NOT IN (0, 6)
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
    WHERE EXTRACT(DOW FROM daily_prices.date::date) NOT IN (0, 6)
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
      AND EXTRACT(DOW FROM daily_prices.date::date) NOT IN (0, 6)
  `);
  const row = result.rows[0] as DateRow | undefined;
  return row?.result_date ?? null;
}

