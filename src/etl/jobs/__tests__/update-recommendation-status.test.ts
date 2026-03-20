import { describe, it, expect } from "vitest";
import {
  shouldTriggerStopLoss,
  shouldTriggerTrailingStop,
  HARD_STOP_LOSS_PERCENT,
  TRAILING_STOP_THRESHOLD,
  MIN_MAX_PNL_FOR_TRAILING,
} from "../update-recommendation-status";

// =============================================================================
// shouldTriggerStopLoss — Hard stop-loss 순수 함수 테스트
// =============================================================================

describe("shouldTriggerStopLoss", () => {
  it("PnL이 -7% 이하이면 발동한다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: 2, pnlPercent: -7 }),
    ).toBe(true);
  });

  it("PnL이 -7% 미만(예: -10%)이면 발동한다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: 2, pnlPercent: -10 }),
    ).toBe(true);
  });

  it("PnL이 -6.9%이면 발동하지 않는다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: 2, pnlPercent: -6.9 }),
    ).toBe(false);
  });

  it("PnL이 0%이면 발동하지 않는다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: 2, pnlPercent: 0 }),
    ).toBe(false);
  });

  it("PnL이 양수이면 발동하지 않는다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: 2, pnlPercent: 5 }),
    ).toBe(false);
  });

  it("currentPhase가 null이면 ETL 미완료로 미발동한다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: null, pnlPercent: -20 }),
    ).toBe(false);
  });

  it("극단적 손실(-32.7%)에서도 발동한다", () => {
    expect(
      shouldTriggerStopLoss({ currentPhase: 4, pnlPercent: -32.7 }),
    ).toBe(true);
  });

  it("HARD_STOP_LOSS_PERCENT 상수가 -7이다", () => {
    expect(HARD_STOP_LOSS_PERCENT).toBe(-7);
  });
});

// =============================================================================
// shouldTriggerTrailingStop — 기존 trailing stop 순수 함수 테스트
// =============================================================================

describe("shouldTriggerTrailingStop", () => {
  it("maxPnL 10% 이상이고 50% 이상 되돌림이면 발동한다", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 20,
        pnlPercent: 9, // 20 * 0.5 = 10, 9 < 10 → 발동
      }),
    ).toBe(true);
  });

  it("maxPnL이 10% 미만이면 미발동한다", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 9,
        pnlPercent: 2,
      }),
    ).toBe(false);
  });

  it("되돌림이 50% 미만이면 미발동한다", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 20,
        pnlPercent: 11, // 20 * 0.5 = 10, 11 > 10 → 미발동
      }),
    ).toBe(false);
  });

  it("currentPhase가 null이면 미발동한다", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: null,
        maxPnlPercent: 30,
        pnlPercent: 5,
      }),
    ).toBe(false);
  });

  it("AAOI 사례: +27.4% → -5.7% 되돌림에서 발동한다", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 3,
        maxPnlPercent: 27.4,
        pnlPercent: -5.7, // 27.4 * 0.5 = 13.7, -5.7 < 13.7 → 발동
      }),
    ).toBe(true);
  });

  it("상수가 올바른 값이다", () => {
    expect(TRAILING_STOP_THRESHOLD).toBe(0.5);
    expect(MIN_MAX_PNL_FOR_TRAILING).toBe(10);
  });
});

// =============================================================================
// 우선순위 테스트: stop-loss > trailing stop > phase exit
// =============================================================================

describe("우선순위: hard stop-loss는 trailing stop보다 우선", () => {
  it("두 조건 모두 충족 시 stop-loss가 우선한다 (실제 로직에서 isStopLoss가 true이면 trailing stop 체크 스킵)", () => {
    // PnL -15%: stop-loss 발동 AND maxPnL 20%에서 trailing stop도 발동 가능
    const params = { currentPhase: 3, pnlPercent: -15, maxPnlPercent: 20 };

    const isStopLoss = shouldTriggerStopLoss({
      currentPhase: params.currentPhase,
      pnlPercent: params.pnlPercent,
    });
    // 실제 코드에서는 !isStopLoss && shouldTriggerTrailingStop(...)으로 체크
    const isTrailingStop = !isStopLoss && shouldTriggerTrailingStop(params);

    expect(isStopLoss).toBe(true);
    expect(isTrailingStop).toBe(false);
  });
});
