/**
 * ETL: Load dark pool trades from Unusual Whales API.
 * Fetches daily dark pool trades → aggregates per symbol → upserts to darkpool_daily.
 */
import "dotenv/config";
import { db } from "@/db/client";
import { darkpoolDaily } from "@/db/schema/analyst";
import { sql } from "drizzle-orm";
import { retryDatabaseOperation } from "@/lib/retry";
import { logger } from "@/lib/logger";
import {
  createUWApiConfig,
  fetchDarkPoolTrades,
} from "@/lib/unusual-whales-client";
import type {
  DarkPoolTradeRecord,
  DarkPoolDailyAgg,
} from "@/types/unusual-whales";

const TAG = "LOAD_DARKPOOL";

/**
 * Aggregate individual dark pool trades into daily per-symbol metrics.
 */
export function aggregateDarkPoolTrades(
  records: DarkPoolTradeRecord[],
): DarkPoolDailyAgg[] {
  const bySymbolDate = new Map<string, DarkPoolTradeRecord[]>();

  for (const r of records) {
    const key = `${r.symbol}|${r.date}`;
    const arr = bySymbolDate.get(key);
    if (arr != null) {
      arr.push(r);
    } else {
      bySymbolDate.set(key, [r]);
    }
  }

  const result: DarkPoolDailyAgg[] = [];

  for (const [, group] of bySymbolDate) {
    const first = group[0];
    let totalNotional = 0;
    let totalShares = 0;
    let priceSum = 0;

    for (const r of group) {
      totalNotional += Number(r.notionalValue) || 0;
      totalShares += r.size;
      priceSum += Number(r.price) || 0;
    }

    const tradeCount = group.length;
    const avgPrice = tradeCount > 0 ? priceSum / tradeCount : 0;
    const blockSize = tradeCount > 0 ? Math.round(totalShares / tradeCount) : 0;

    result.push({
      symbol: first.symbol,
      date: first.date,
      totalNotional,
      totalShares,
      tradeCount,
      avgPrice: Math.round(avgPrice * 100) / 100,
      blockSize,
    });
  }

  return result;
}

async function upsertDarkPoolDaily(aggs: DarkPoolDailyAgg[]): Promise<void> {
  if (aggs.length === 0) return;

  await retryDatabaseOperation(async () => {
    for (const agg of aggs) {
      await db
        .insert(darkpoolDaily)
        .values({
          symbol: agg.symbol,
          date: agg.date,
          totalNotional: String(agg.totalNotional),
          totalShares: agg.totalShares,
          tradeCount: agg.tradeCount,
          avgPrice: String(agg.avgPrice),
          avgTradeSize: agg.blockSize,
        })
        .onConflictDoUpdate({
          target: [darkpoolDaily.symbol, darkpoolDaily.date],
          set: {
            totalNotional: sql`EXCLUDED.total_notional`,
            totalShares: sql`EXCLUDED.total_shares`,
            tradeCount: sql`EXCLUDED.trade_count`,
            avgPrice: sql`EXCLUDED.avg_price`,
            avgTradeSize: sql`EXCLUDED.avg_trade_size`,
          },
        });
    }
  });
}

export async function loadDarkPool(targetDate: string): Promise<void> {
  logger.step(`\n── Load Dark Pool: ${targetDate} ──`);

  const config = createUWApiConfig();
  const records = await fetchDarkPoolTrades(config, targetDate);

  if (records.length === 0) {
    logger.warn(TAG, `No dark pool trades for ${targetDate}`);
    return;
  }

  logger.info(TAG, `Fetched ${records.length} raw trades`);
  const aggs = aggregateDarkPoolTrades(records);
  logger.info(TAG, `Aggregated into ${aggs.length} symbol-day records`);

  await upsertDarkPoolDaily(aggs);
  logger.info(TAG, `Upserted ${aggs.length} dark pool daily records`);
}
