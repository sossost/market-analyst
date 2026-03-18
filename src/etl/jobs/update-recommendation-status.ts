import "dotenv/config";
import { db, pool } from "@/db/client";
import { recommendations } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { eq, sql } from "drizzle-orm";
import { logger } from "@/agent/logger";

const TAG = "UPDATE_RECOMMENDATION_STATUS";

/** maxPnL 대비 되돌림 비율이 이 값 이상이면 trailing stop 발동 */
export const TRAILING_STOP_THRESHOLD = 0.5;

/** trailing stop이 활성화되려면 maxPnL이 이 값(%) 이상이어야 함 */
export const MIN_MAX_PNL_FOR_TRAILING = 10;

/**
 * Trailing stop 발동 여부를 판정하는 순수 함수.
 *
 * - currentPhase == null: ETL 미완료를 의미하므로 미발동
 * - maxPnlPercent < MIN_MAX_PNL_FOR_TRAILING: 충분한 수익 미달성 시 미발동
 * - pnlPercent < maxPnlPercent * (1 - TRAILING_STOP_THRESHOLD): 고점 대비 50% 이상 되돌림 시 발동
 */
export function shouldTriggerTrailingStop(params: {
  currentPhase: number | null;
  maxPnlPercent: number;
  pnlPercent: number;
}): boolean {
  return (
    params.currentPhase != null &&
    params.maxPnlPercent >= MIN_MAX_PNL_FOR_TRAILING &&
    params.pnlPercent < params.maxPnlPercent * (1 - TRAILING_STOP_THRESHOLD)
  );
}

/**
 * 일간 ETL: ACTIVE 추천 종목의 성과를 업데이트한다.
 *
 * 흐름:
 * 1. 최신 거래일 확인
 * 2. ACTIVE 추천 조회
 * 3. 각 종목의 현재 종가/Phase/RS 조회
 * 4. PnL, maxPnl, daysHeld 계산
 * 5. Phase 2 이탈 시 CLOSED_PHASE_EXIT 처리
 * 6. Trailing stop 조건 충족 시 CLOSED_TRAILING_STOP 처리 (Phase 이탈보다 후순위)
 */
async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping recommendation update.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  // 1. ACTIVE 추천 조회
  const activeRecs = await retryDatabaseOperation(() =>
    db
      .select()
      .from(recommendations)
      .where(eq(recommendations.status, "ACTIVE")),
  );

  if (activeRecs.length === 0) {
    logger.info(TAG, "No active recommendations. Nothing to update.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Active recommendations: ${activeRecs.length}`);

  const symbols = activeRecs.map((r) => r.symbol);

  // 2. 현재 종가 + Phase/RS 조회 (JOIN으로 단일 쿼리)
  const { rows: dataRows } = await retryDatabaseOperation(() =>
    pool.query<{
      symbol: string;
      close: string;
      phase: number | null;
      rs_score: number | null;
    }>(
      `SELECT p.symbol, p.close::text, sp.phase, sp.rs_score
       FROM daily_prices p
       LEFT JOIN stock_phases sp ON p.symbol = sp.symbol AND p.date = sp.date
       WHERE p.symbol = ANY($1) AND p.date = $2`,
      [symbols, targetDate],
    ),
  );
  const dataBySymbol = new Map(
    dataRows.map((r) => [
      r.symbol,
      { price: toNum(r.close), phase: r.phase, rs: r.rs_score },
    ]),
  );

  // 4. 각 추천 업데이트
  let closedCount = 0;

  for (const rec of activeRecs) {
    const data = dataBySymbol.get(rec.symbol);
    if (data == null || data.price === 0) continue;

    const currentPrice = data.price;
    const currentPhase = data.phase ?? null;
    const currentRs = data.rs ?? null;

    const entryPrice = toNum(rec.entryPrice);
    if (entryPrice === 0) continue;

    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const prevMaxPnl = toNum(rec.maxPnlPercent);
    const maxPnlPercent = Math.max(prevMaxPnl, pnlPercent);
    const daysHeld = (rec.daysHeld ?? 0) + 1;

    // Phase 2 이탈 체크
    const isPhaseExit = currentPhase != null && currentPhase !== 2;

    // Trailing stop 체크 (Phase 이탈보다 후순위)
    const isTrailingStop = shouldTriggerTrailingStop({
      currentPhase,
      maxPnlPercent,
      pnlPercent,
    });

    await retryDatabaseOperation(() =>
      db
        .update(recommendations)
        .set({
          currentPrice: String(currentPrice),
          currentPhase: currentPhase,
          currentRsScore: currentRs,
          pnlPercent: String(pnlPercent),
          maxPnlPercent: String(maxPnlPercent),
          daysHeld,
          lastUpdated: targetDate,
          ...(isPhaseExit
            ? {
                status: "CLOSED_PHASE_EXIT",
                closeDate: targetDate,
                closePrice: String(currentPrice),
                closeReason: `Phase ${currentPhase} 이탈 (RS ${currentRs ?? "N/A"})`,
              }
            : {}),
          ...(isTrailingStop && !isPhaseExit
            ? {
                status: "CLOSED_TRAILING_STOP",
                closeDate: targetDate,
                closePrice: String(currentPrice),
                closeReason: `Trailing stop: maxPnL ${maxPnlPercent.toFixed(1)}% → 현재 ${pnlPercent.toFixed(1)}% (${TRAILING_STOP_THRESHOLD * 100}% 되돌림 초과)`,
              }
            : {}),
        })
        .where(eq(recommendations.id, rec.id)),
    );

    if (isPhaseExit || isTrailingStop) closedCount++;
  }

  logger.info(
    TAG,
    `Done. Updated: ${activeRecs.length}, Closed today: ${closedCount}`,
  );
  await pool.end();
}

main().catch((err) => {
  logger.error(TAG, `update-recommendation-status failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
