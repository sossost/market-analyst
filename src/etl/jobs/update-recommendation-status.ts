import "dotenv/config";
import { db, pool } from "@/db/client";
import { recommendations } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { eq, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { findRecommendationCurrentData } from "@/db/repositories/index.js";

const TAG = "UPDATE_RECOMMENDATION_STATUS";

/** maxPnL 대비 되돌림 비율이 이 값 이상이면 trailing stop 발동 */
export const TRAILING_STOP_THRESHOLD = 0.5;

/** trailing stop이 활성화되려면 maxPnL이 이 값(%) 이상이어야 함 */
export const MIN_MAX_PNL_FOR_TRAILING = 10;

/**
 * 진입가 대비 최대 허용 손실(%).
 * 이 값 이하로 PnL이 떨어지면 무조건 손절한다.
 * 근거: EONR -32.7% 방치 사례 — trailing stop은 수익 구간 진입 후에만 작동하므로,
 * 수익 구간에 한 번도 도달하지 못한 종목은 무한 손실에 노출된다.
 */
export const HARD_STOP_LOSS_PERCENT = -7;

/**
 * Hard stop-loss 발동 여부를 판정하는 순수 함수.
 *
 * - currentPhase == null: ETL 미완료를 의미하므로 미발동
 * - pnlPercent <= HARD_STOP_LOSS_PERCENT: 진입가 대비 -7% 이하 시 발동
 */
export function shouldTriggerStopLoss(params: {
  currentPhase: number | null;
  pnlPercent: number;
}): boolean {
  return (
    params.currentPhase != null &&
    params.pnlPercent <= HARD_STOP_LOSS_PERCENT
  );
}

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
 * 5. Hard stop-loss 조건 충족 시 CLOSED_STOP_LOSS 처리 (최우선)
 * 6. Trailing stop 조건 충족 시 CLOSED_TRAILING_STOP 처리
 * 7. Phase 2 이탈 시 CLOSED_PHASE_EXIT 처리
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
  const dataRows = await retryDatabaseOperation(() =>
    findRecommendationCurrentData(symbols, targetDate),
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

    // Hard stop-loss 체크 (최우선 — 무한 손실 방지)
    const isStopLoss = shouldTriggerStopLoss({ currentPhase, pnlPercent });

    // Trailing stop 체크 (Phase 이탈보다 우선 — 수익 보호)
    const isTrailingStop = !isStopLoss && shouldTriggerTrailingStop({
      currentPhase,
      maxPnlPercent,
      pnlPercent,
    });

    const shouldClose = isStopLoss || isTrailingStop || isPhaseExit;

    let closeStatus: string | undefined;
    let closeReason: string | undefined;
    if (isStopLoss) {
      closeStatus = "CLOSED_STOP_LOSS";
      closeReason = `Hard stop-loss: PnL ${pnlPercent.toFixed(1)}% ≤ ${HARD_STOP_LOSS_PERCENT}% 한도 초과`;
    } else if (isTrailingStop) {
      closeStatus = "CLOSED_TRAILING_STOP";
      closeReason = `Trailing stop: maxPnL ${maxPnlPercent.toFixed(1)}% → 현재 ${pnlPercent.toFixed(1)}% (${TRAILING_STOP_THRESHOLD * 100}% 되돌림 초과)`;
    } else if (isPhaseExit) {
      closeStatus = "CLOSED_PHASE_EXIT";
      closeReason = `Phase ${currentPhase} 이탈 (RS ${currentRs ?? "N/A"})`;
    }

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
          ...(shouldClose && closeStatus != null
            ? {
                status: closeStatus,
                closeDate: targetDate,
                closePrice: String(currentPrice),
                closeReason,
              }
            : {}),
        })
        .where(eq(recommendations.id, rec.id)),
    );

    if (shouldClose) closedCount++;
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
