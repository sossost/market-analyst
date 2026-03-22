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

/**
 * 단계적 이익 실현 (Progressive Trailing Stop) 설정.
 *
 * maxPnL 구간별로 되돌림 허용 비율과 이익 바닥(profit floor)을 차등 적용한다.
 * 배열은 minMaxPnl 내림차순으로 정렬해야 한다 (가장 높은 tier부터 매칭).
 *
 * - retracement: 고점 대비 허용 되돌림 비율 (0.25 = 25%)
 * - profitFloor: 해당 tier 진입 후 최소 보장 수익률(%)
 *
 * 근거: #359 — AAOI +27.4% → -5.7% 사례. Phase exit 의존 청산으로 수익 증발.
 * 주의: AAOI/DWSN 2건 기반 초기 추정값. 운영 데이터 축적 후 조정 필요.
 */
export const PROFIT_TIERS = [
  { minMaxPnl: 20, retracement: 0.25, profitFloor: 10 },
  { minMaxPnl: 10, retracement: 0.30, profitFloor: 3 },
  { minMaxPnl: 5, retracement: 0.40, profitFloor: 0 },
] as const;

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
 * 현재 maxPnl에 해당하는 profit tier를 찾는다.
 * PROFIT_TIERS는 minMaxPnl 내림차순이므로 첫 번째 매칭이 가장 높은 tier.
 */
export function findProfitTier(maxPnlPercent: number) {
  return PROFIT_TIERS.find((tier) => maxPnlPercent >= tier.minMaxPnl) ?? null;
}

/**
 * Trailing stop 발동 여부를 판정하는 순수 함수.
 *
 * 단계적 이익 실현 로직:
 * 1. currentPhase == null → ETL 미완료, 미발동
 * 2. maxPnlPercent에 해당하는 profit tier 탐색
 * 3. tier 없으면 (maxPnl < 5%) 미발동
 * 4. trailing level = max(maxPnl * (1 - retracement), profitFloor)
 * 5. pnlPercent < trailing level → 발동
 *
 * 예: maxPnl 27.4% → tier(20, 0.25, 10) → level = max(20.55, 10) = 20.55
 *     pnl이 20.55% 아래로 떨어지면 발동
 */
export function shouldTriggerTrailingStop(params: {
  currentPhase: number | null;
  maxPnlPercent: number;
  pnlPercent: number;
}): boolean {
  if (params.currentPhase == null) return false;

  const tier = findProfitTier(params.maxPnlPercent);
  if (tier == null) return false;

  const trailingLevel = Math.max(
    params.maxPnlPercent * (1 - tier.retracement),
    tier.profitFloor,
  );

  return params.pnlPercent < trailingLevel;
}

/**
 * 트레일링 스탑 발동 시 closeReason에 포함할 설명 문자열 생성.
 */
export function formatTrailingStopReason(params: {
  maxPnlPercent: number;
  pnlPercent: number;
}): string {
  const tier = findProfitTier(params.maxPnlPercent);
  if (tier == null) return `Trailing stop: maxPnL ${params.maxPnlPercent.toFixed(1)}%`;

  const trailingLevel = Math.max(
    params.maxPnlPercent * (1 - tier.retracement),
    tier.profitFloor,
  );
  const retracementPct = tier.retracement * 100;

  return `Trailing stop: maxPnL ${params.maxPnlPercent.toFixed(1)}% → 현재 ${params.pnlPercent.toFixed(1)}% (tier ${tier.minMaxPnl}%+: ${retracementPct}% 되돌림, floor ${tier.profitFloor}%, level ${trailingLevel.toFixed(1)}%)`;
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
      closeReason = formatTrailingStopReason({ maxPnlPercent, pnlPercent });
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
