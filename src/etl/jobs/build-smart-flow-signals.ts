/**
 * ETL: Build smart flow signals from options flow + dark pool daily aggregates.
 * Reads today's options_flow_daily and darkpool_daily,
 * generates composite SmartFlowSignal, cross-references with Phase 2 stocks,
 * and upserts to smart_flow_signals.
 */
import "dotenv/config";
import { db, pool } from "@/db/client";
import {
  optionsFlowDaily,
  darkpoolDaily,
  smartFlowSignals,
} from "@/db/schema/analyst";
import { eq, and, sql } from "drizzle-orm";
import { retryDatabaseOperation } from "@/lib/retry";
import { logger } from "@/lib/logger";
import {
  generateSmartFlowSignal,
  markAsConfirming,
} from "@/lib/smart-flow-signal";
import type {
  OptionsFlowDailyAgg,
  DarkPoolDailyAgg,
  SmartFlowSignal,
} from "@/types/unusual-whales";

const TAG = "BUILD_SMART_FLOW";

/**
 * Fetch symbols currently in Phase 2 for cross-referencing.
 */
async function getPhase2Symbols(targetDate: string): Promise<Set<string>> {
  const result = await pool.query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM stock_phases
     WHERE date = $1 AND phase = 2`,
    [targetDate],
  );
  return new Set(result.rows.map((r) => r.symbol));
}

export async function buildSmartFlowSignals(
  targetDate: string,
): Promise<void> {
  logger.step(`\n── Build Smart Flow Signals: ${targetDate} ──`);

  // 1. Read today's aggregated data
  const optionsRows = await db
    .select()
    .from(optionsFlowDaily)
    .where(eq(optionsFlowDaily.date, targetDate));

  const darkpoolRows = await db
    .select()
    .from(darkpoolDaily)
    .where(eq(darkpoolDaily.date, targetDate));

  logger.info(
    TAG,
    `Found ${optionsRows.length} options flow + ${darkpoolRows.length} dark pool records`,
  );

  if (optionsRows.length === 0 && darkpoolRows.length === 0) {
    logger.warn(TAG, "No flow data for signal generation");
    return;
  }

  // 2. Index by symbol for lookup
  const optionsBySymbol = new Map<string, OptionsFlowDailyAgg>();
  for (const row of optionsRows) {
    optionsBySymbol.set(row.symbol, {
      symbol: row.symbol,
      date: row.date,
      totalPremium: Number(row.totalPremium),
      callPremium: Number(row.callPremium),
      putPremium: Number(row.putPremium),
      callPutRatio: Number(row.callPutRatio),
      totalContracts: row.totalContracts,
      sweepCount: row.sweepCount,
      blockCount: row.blockCount,
      unusualCount: row.unusualCount,
      bullishPremium: Number(row.bullishPremium),
      bearishPremium: Number(row.bearishPremium),
      sentimentScore: row.sentimentScore ?? 0,
    });
  }

  const darkpoolBySymbol = new Map<string, DarkPoolDailyAgg>();
  for (const row of darkpoolRows) {
    darkpoolBySymbol.set(row.symbol, {
      symbol: row.symbol,
      date: row.date,
      totalNotional: Number(row.totalNotional),
      totalShares: row.totalShares,
      tradeCount: row.tradeCount,
      avgPrice: Number(row.avgPrice),
      blockSize: row.avgTradeSize ?? 0,
    });
  }

  // 3. Collect all unique symbols
  const allSymbols = new Set([
    ...optionsBySymbol.keys(),
    ...darkpoolBySymbol.keys(),
  ]);

  // 4. Get Phase 2 stocks for cross-reference
  const phase2Symbols = await getPhase2Symbols(targetDate);

  // 5. Generate signals
  const signals: SmartFlowSignal[] = [];
  for (const symbol of allSymbols) {
    const optFlow = optionsBySymbol.get(symbol) ?? null;
    const dp = darkpoolBySymbol.get(symbol) ?? null;

    let signal = generateSmartFlowSignal(symbol, targetDate, optFlow, dp);
    if (signal == null) continue;

    // Cross-reference: does this stock already have a Phase 2 signal?
    if (phase2Symbols.has(symbol)) {
      signal = markAsConfirming(signal);
    }

    signals.push(signal);
  }

  logger.info(
    TAG,
    `Generated ${signals.length} signals (${signals.filter((s) => s.confirmsExisting).length} confirming Phase 2)`,
  );

  // 6. Upsert to DB
  if (signals.length > 0) {
    await upsertSignals(signals);
    logger.info(TAG, `Upserted ${signals.length} smart flow signals`);
  }
}

async function upsertSignals(signals: SmartFlowSignal[]): Promise<void> {
  await retryDatabaseOperation(async () => {
    for (const s of signals) {
      await db
        .insert(smartFlowSignals)
        .values({
          symbol: s.symbol,
          date: s.date,
          signalType: s.signalType,
          strength: s.strength,
          compositeScore: s.compositeScore,
          confirmsExisting: s.confirmsExisting,
          details: JSON.stringify(s.details),
        })
        .onConflictDoUpdate({
          target: [smartFlowSignals.symbol, smartFlowSignals.date],
          set: {
            signalType: sql`EXCLUDED.signal_type`,
            strength: sql`EXCLUDED.strength`,
            compositeScore: sql`EXCLUDED.composite_score`,
            confirmsExisting: sql`EXCLUDED.confirms_existing`,
            details: sql`EXCLUDED.details`,
          },
        });
    }
  });
}
