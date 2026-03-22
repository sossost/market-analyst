import "dotenv/config";
import { db, pool } from "@/db/client";
import { signalLog, signalParams } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import {
  filterSignalsByParams,
  parseSignalParams,
  DEFAULT_SIGNAL_PARAMS,
} from "@/lib/signal-logic";
import type { RawSignal } from "@/lib/signal-logic";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  findPhase1to2Transitions,
  findExistingSignals,
} from "@/db/repositories/index.js";

const TAG = "RECORD_NEW_SIGNALS";

/**
 * Phase 1→2 전환 시그널을 자동 감지하여 signal_log에 기록한다.
 *
 * 흐름:
 * 1. 최신 거래일의 Phase 1→2 전환 종목 조회
 * 2. 이미 기록된 (symbol, entry_date) 제외
 * 3. 활성 파라미터 로드 → 기준에 맞는 시그널만 INSERT
 */
async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping signal recording.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  // 1. Phase 1→2 전환 시그널 조회
  const rawRows = await retryDatabaseOperation(() =>
    findPhase1to2Transitions(targetDate),
  );

  if (rawRows.length === 0) {
    logger.info(TAG, "No Phase 1→2 transitions found.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Phase 1→2 transitions detected: ${rawRows.length}`);

  // 2. 이미 기록된 시그널 제외
  const symbols = rawRows.map((r) => r.symbol);
  const existingRows = await retryDatabaseOperation(() =>
    findExistingSignals(symbols, targetDate),
  );
  const existingSymbols = new Set(existingRows.map((r) => r.symbol));

  const newRawSignals: RawSignal[] = rawRows
    .filter((r) => !existingSymbols.has(r.symbol))
    .map((r) => ({
      symbol: r.symbol,
      date: targetDate,
      price: toNum(r.close),
      rsScore: r.rs_score,
      volumeConfirmed: r.volume_confirmed,
      sectorGroupPhase: r.sector_group_phase,
      sector: r.sector,
      industry: r.industry,
    }));

  if (newRawSignals.length === 0) {
    logger.info(TAG, "All transitions already recorded.");
    await pool.end();
    return;
  }

  // 3. 활성 파라미터 로드
  const paramRows = await retryDatabaseOperation(() =>
    db
      .select({
        paramName: signalParams.paramName,
        currentValue: signalParams.currentValue,
      })
      .from(signalParams)
      .where(
        sql`${signalParams.id} IN (
          SELECT MAX(id) FROM signal_params GROUP BY param_name
        )`,
      ),
  );
  const params = parseSignalParams(paramRows);

  // 4. 파라미터 기준 필터링
  const filteredSignals = filterSignalsByParams(newRawSignals, params);

  if (filteredSignals.length === 0) {
    logger.info(
      TAG,
      `No signals passed parameter filter (rs>=${params.rsThreshold}, vol=${params.volumeRequired}).`,
    );
    await pool.end();
    return;
  }

  // 5. INSERT
  const paramsSnapshotJson = JSON.stringify(params);

  await retryDatabaseOperation(() =>
    db.insert(signalLog).values(
      filteredSignals.map((s) => ({
        symbol: s.symbol,
        entryDate: s.date,
        entryPrice: String(s.price),
        rsScore: s.rsScore,
        volumeConfirmed: s.volumeConfirmed,
        sectorGroupPhase: s.sectorGroupPhase,
        sector: s.sector,
        industry: s.industry,
        paramsSnapshot: paramsSnapshotJson,
        status: "ACTIVE",
        daysHeld: 0,
        lastUpdated: s.date,
      })),
    ),
  );

  logger.info(
    TAG,
    `Recorded ${filteredSignals.length} new signals (filtered from ${newRawSignals.length} transitions).`,
  );
  logger.info(
    TAG,
    `Params: rs>=${params.rsThreshold}, vol=${params.volumeRequired}, sectorFilter=${params.sectorFilter}`,
  );
  await pool.end();
}

main().catch((err) => {
  logger.error(TAG, `record-new-signals failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
