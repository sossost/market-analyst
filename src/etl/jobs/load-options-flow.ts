/**
 * ETL: Load options flow data from Unusual Whales API.
 * Fetches daily options flow → aggregates per symbol → upserts to options_flow_daily.
 */
import "dotenv/config";
import { db } from "@/db/client";
import { optionsFlowDaily } from "@/db/schema/analyst";
import { sql } from "drizzle-orm";
import { retryDatabaseOperation } from "@/lib/retry";
import { logger } from "@/lib/logger";
import {
  createUWApiConfig,
  fetchOptionsFlow,
} from "@/lib/unusual-whales-client";
import type {
  OptionsFlowRecord,
  OptionsFlowDailyAgg,
} from "@/types/unusual-whales";

const TAG = "LOAD_OPTIONS_FLOW";

const MAX_CALL_PUT_RATIO = 99;

/**
 * Aggregate individual options flow records into daily per-symbol metrics.
 */
export function aggregateOptionsFlow(
  records: OptionsFlowRecord[],
): OptionsFlowDailyAgg[] {
  const bySymbolDate = new Map<string, OptionsFlowRecord[]>();

  for (const r of records) {
    const key = `${r.symbol}|${r.date}`;
    const arr = bySymbolDate.get(key);
    if (arr != null) {
      arr.push(r);
    } else {
      bySymbolDate.set(key, [r]);
    }
  }

  const result: OptionsFlowDailyAgg[] = [];

  for (const [, group] of bySymbolDate) {
    const first = group[0];
    let callPremium = 0;
    let putPremium = 0;
    let bullishPremium = 0;
    let bearishPremium = 0;
    let totalContracts = 0;
    let sweepCount = 0;
    let blockCount = 0;
    let unusualCount = 0;

    for (const r of group) {
      const premium = Number(r.premium) || 0;
      totalContracts += r.volume;

      if (r.putCall === "CALL") {
        callPremium += premium;
      } else {
        putPremium += premium;
      }

      if (r.sentiment === "BULLISH") {
        bullishPremium += premium;
      } else if (r.sentiment === "BEARISH") {
        bearishPremium += premium;
      }

      if (r.isSweep) sweepCount++;
      if (r.isBlock) blockCount++;
      if (r.isUnusual) unusualCount++;
    }

    const totalPremium = callPremium + putPremium;
    const callPutRatio =
      putPremium === 0
        ? Math.min(callPremium > 0 ? MAX_CALL_PUT_RATIO : 0, MAX_CALL_PUT_RATIO)
        : Math.min(callPremium / putPremium, MAX_CALL_PUT_RATIO);

    // Sentiment score: -100 to +100
    const totalSentimentPremium = bullishPremium + bearishPremium;
    const sentimentScore =
      totalSentimentPremium === 0
        ? 0
        : Math.round(
            ((bullishPremium - bearishPremium) / totalSentimentPremium) * 100,
          );

    result.push({
      symbol: first.symbol,
      date: first.date,
      totalPremium,
      callPremium,
      putPremium,
      callPutRatio: Math.round(callPutRatio * 100) / 100,
      totalContracts,
      sweepCount,
      blockCount,
      unusualCount,
      bullishPremium,
      bearishPremium,
      sentimentScore,
    });
  }

  return result;
}

async function upsertOptionsFlowDaily(
  aggs: OptionsFlowDailyAgg[],
): Promise<void> {
  if (aggs.length === 0) return;

  await retryDatabaseOperation(async () => {
    for (const agg of aggs) {
      await db
        .insert(optionsFlowDaily)
        .values({
          symbol: agg.symbol,
          date: agg.date,
          totalPremium: String(agg.totalPremium),
          callPremium: String(agg.callPremium),
          putPremium: String(agg.putPremium),
          callPutRatio: String(agg.callPutRatio),
          totalContracts: agg.totalContracts,
          sweepCount: agg.sweepCount,
          blockCount: agg.blockCount,
          unusualCount: agg.unusualCount,
          bullishPremium: String(agg.bullishPremium),
          bearishPremium: String(agg.bearishPremium),
          sentimentScore: agg.sentimentScore,
        })
        .onConflictDoUpdate({
          target: [optionsFlowDaily.symbol, optionsFlowDaily.date],
          set: {
            totalPremium: sql`EXCLUDED.total_premium`,
            callPremium: sql`EXCLUDED.call_premium`,
            putPremium: sql`EXCLUDED.put_premium`,
            callPutRatio: sql`EXCLUDED.call_put_ratio`,
            totalContracts: sql`EXCLUDED.total_contracts`,
            sweepCount: sql`EXCLUDED.sweep_count`,
            blockCount: sql`EXCLUDED.block_count`,
            unusualCount: sql`EXCLUDED.unusual_count`,
            bullishPremium: sql`EXCLUDED.bullish_premium`,
            bearishPremium: sql`EXCLUDED.bearish_premium`,
            sentimentScore: sql`EXCLUDED.sentiment_score`,
          },
        });
    }
  });
}

export async function loadOptionsFlow(targetDate: string): Promise<void> {
  logger.step(`\n── Load Options Flow: ${targetDate} ──`);

  const config = createUWApiConfig();
  const records = await fetchOptionsFlow(config, targetDate);

  if (records.length === 0) {
    logger.warn(TAG, `No options flow records for ${targetDate}`);
    return;
  }

  logger.info(TAG, `Fetched ${records.length} raw records`);
  const aggs = aggregateOptionsFlow(records);
  logger.info(TAG, `Aggregated into ${aggs.length} symbol-day records`);

  await upsertOptionsFlowDaily(aggs);
  logger.info(TAG, `Upserted ${aggs.length} options flow daily records`);
}
