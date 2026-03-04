import "dotenv/config";
import { db, pool } from "@/db/client";
import { stockPhases } from "@/db/schema/analyst";
import { detectPhase } from "@/lib/phase-detection";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { chunk, toNum } from "@/etl/utils/common";
import { sql } from "drizzle-orm";
import type { PhaseInput } from "@/types";

const BATCH_SIZE = 200;
const CLOSE_DAYS_NEEDED = 170; // 150 for MA150 + 20 for slope
const HIGH_LOW_DAYS = 252; // ~1 year trading days

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    console.error("No trade date found in daily_prices. Exiting.");
    process.exit(1);
  }

  console.log(`Target date: ${targetDate}`);

  // Get all active, non-ETF symbols
  const { rows: symbolRows } = await retryDatabaseOperation(() =>
    pool.query<{ symbol: string; sector: string | null; industry: string | null }>(
      `SELECT symbol, sector, industry FROM symbols
       WHERE is_actively_trading = true AND is_etf = false
       ORDER BY symbol`,
    ),
  );

  console.log(`Active symbols: ${symbolRows.length}`);

  const batches = chunk(symbolRows, BATCH_SIZE);
  let processed = 0;
  let phase2Count = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchSymbols = batch.map((s) => s.symbol);

    console.log(
      `Batch ${i + 1}/${batches.length} (${batchSymbols.length} symbols)`,
    );

    // 1. Fetch close prices for MA150 calculation
    const { rows: closeRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; date: string; close: string | null }>(
        `SELECT symbol, date, close FROM daily_prices
         WHERE symbol = ANY($1) AND date <= $2
         ORDER BY symbol, date DESC`,
        [batchSymbols, targetDate],
      ),
    );

    const closesBySymbol = new Map<string, { date: string; close: number }[]>();
    for (const row of closeRows) {
      if (row.close == null) continue;
      const arr = closesBySymbol.get(row.symbol) ?? [];
      arr.push({ date: row.date, close: toNum(row.close) });
      closesBySymbol.set(row.symbol, arr);
    }

    // 2. Fetch MA data (today)
    const { rows: maRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; ma50: string | null; ma200: string | null }>(
        `SELECT symbol, ma50, ma200 FROM daily_ma
         WHERE symbol = ANY($1) AND date = $2`,
        [batchSymbols, targetDate],
      ),
    );
    const maBySymbol = new Map(maRows.map((r) => [r.symbol, r]));

    // 3. Fetch RS scores (today)
    const { rows: rsRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; rs_score: number | null }>(
        `SELECT symbol, rs_score FROM daily_prices
         WHERE symbol = ANY($1) AND date = $2`,
        [batchSymbols, targetDate],
      ),
    );
    const rsBySymbol = new Map<string, number>();
    for (const row of rsRows) {
      if (row.rs_score != null) {
        rsBySymbol.set(row.symbol, row.rs_score);
      }
    }

    // 4. Fetch 52-week high/low
    const { rows: highLowRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; high_52w: string; low_52w: string }>(
        `SELECT symbol, MAX(high)::text AS high_52w, MIN(low)::text AS low_52w
         FROM daily_prices
         WHERE symbol = ANY($1)
           AND date > (
             SELECT date FROM (
               SELECT DISTINCT date FROM daily_prices
               WHERE date <= $2
               ORDER BY date DESC LIMIT $3
             ) sub ORDER BY date ASC LIMIT 1
           )
           AND date <= $2
         GROUP BY symbol`,
        [batchSymbols, targetDate, HIGH_LOW_DAYS],
      ),
    );
    const highLowBySymbol = new Map(
      highLowRows.map((r) => [
        r.symbol,
        { high: toNum(r.high_52w), low: toNum(r.low_52w) },
      ]),
    );

    // 5. Fetch previous day's phases for transition detection
    const { rows: prevPhaseRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; phase: number }>(
        `SELECT symbol, phase FROM stock_phases
         WHERE symbol = ANY($1)
           AND date = (SELECT MAX(date) FROM stock_phases WHERE date < $2)`,
        [batchSymbols, targetDate],
      ),
    );
    const prevPhaseBySymbol = new Map(
      prevPhaseRows.map((r) => [r.symbol, r.phase]),
    );

    // 6. Calculate phase for each symbol
    const upsertRows: UpsertRow[] = [];

    for (const sym of batch) {
      const closes = closesBySymbol.get(sym.symbol);
      if (closes == null || closes.length < 150) continue;

      const ma = maBySymbol.get(sym.symbol);
      if (ma == null) continue;

      const ma150Today = calculateMa150(closes, 0, 150);
      const ma150_20dAgo =
        closes.length >= CLOSE_DAYS_NEEDED
          ? calculateMa150(closes, 20, 150)
          : ma150Today;

      const rsScore = rsBySymbol.get(sym.symbol) ?? 50;
      const highLow = highLowBySymbol.get(sym.symbol) ?? { high: 0, low: 0 };
      const price = closes[0].close;

      const input: PhaseInput = {
        price,
        ma50: toNum(ma.ma50),
        ma150: ma150Today,
        ma200: toNum(ma.ma200),
        ma150_20dAgo,
        rsScore,
        high52w: highLow.high,
        low52w: highLow.low,
      };

      const result = detectPhase(input);
      const prevPhase = prevPhaseBySymbol.get(sym.symbol) ?? null;

      if (result.phase === 2) phase2Count++;

      upsertRows.push({
        symbol: sym.symbol,
        date: targetDate,
        phase: result.phase,
        prevPhase,
        ma150: ma150Today,
        ma150Slope: result.ma150Slope,
        rsScore,
        pctFromHigh52w:
          highLow.high > 0 ? (price - highLow.high) / highLow.high : null,
        pctFromLow52w:
          highLow.low > 0 ? (price - highLow.low) / highLow.low : null,
        conditionsMet: JSON.stringify(result.detail.conditionsMet),
      });
    }

    // 7. Batch upsert
    if (upsertRows.length > 0) {
      await retryDatabaseOperation(() => batchUpsert(upsertRows));
      processed += upsertRows.length;
    }
  }

  console.log(`\nDone. Processed: ${processed}, Phase 2: ${phase2Count}`);
  await pool.end();
}

/**
 * Calculate MA150 from sorted-desc close prices.
 * offset: skip this many entries from the front (0 = today, 20 = 20 days ago)
 */
function calculateMa150(
  closes: { close: number }[],
  offset: number,
  period: number,
): number {
  const slice = closes.slice(offset, offset + period);
  if (slice.length < period) return 0;
  const sum = slice.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

type UpsertRow = {
  symbol: string;
  date: string;
  phase: number;
  prevPhase: number | null;
  ma150: number | null;
  ma150Slope: number | null;
  rsScore: number | null;
  pctFromHigh52w: number | null;
  pctFromLow52w: number | null;
  conditionsMet: string | null;
};

async function batchUpsert(rows: UpsertRow[]) {
  const UPSERT_BATCH = 50;
  const batches = chunk(rows, UPSERT_BATCH);

  for (const batch of batches) {
    const values = batch.map((r) => ({
      symbol: r.symbol,
      date: r.date,
      phase: r.phase,
      prevPhase: r.prevPhase,
      ma150: r.ma150 != null ? String(r.ma150) : null,
      ma150Slope: r.ma150Slope != null ? String(r.ma150Slope) : null,
      rsScore: r.rsScore,
      pctFromHigh52w:
        r.pctFromHigh52w != null ? String(r.pctFromHigh52w) : null,
      pctFromLow52w:
        r.pctFromLow52w != null ? String(r.pctFromLow52w) : null,
      conditionsMet: r.conditionsMet,
    }));

    await db
      .insert(stockPhases)
      .values(values)
      .onConflictDoUpdate({
        target: [stockPhases.symbol, stockPhases.date],
        set: {
          phase: sql`EXCLUDED.phase`,
          prevPhase: sql`EXCLUDED.prev_phase`,
          ma150: sql`EXCLUDED.ma150`,
          ma150Slope: sql`EXCLUDED.ma150_slope`,
          rsScore: sql`EXCLUDED.rs_score`,
          pctFromHigh52w: sql`EXCLUDED.pct_from_high_52w`,
          pctFromLow52w: sql`EXCLUDED.pct_from_low_52w`,
          conditionsMet: sql`EXCLUDED.conditions_met`,
        },
      });
  }
}

main().catch((err) => {
  console.error("build-stock-phases failed:", err);
  pool.end();
  process.exit(1);
});
