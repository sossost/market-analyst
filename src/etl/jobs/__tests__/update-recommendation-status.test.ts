import { describe, it, expect } from "vitest";
import {
  shouldTriggerStopLoss,
  shouldTriggerTrailingStop,
  findProfitTier,
  formatTrailingStopReason,
  HARD_STOP_LOSS_PERCENT,
  PROFIT_TIERS,
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
// findProfitTier — tier 탐색 테스트
// =============================================================================

describe("findProfitTier", () => {
  it("maxPnl 25%이면 20% tier를 반환한다", () => {
    const tier = findProfitTier(25);
    expect(tier).toEqual({ minMaxPnl: 20, retracement: 0.25, profitFloor: 10 });
  });

  it("maxPnl 20%이면 20% tier를 반환한다 (경계값)", () => {
    const tier = findProfitTier(20);
    expect(tier).toEqual({ minMaxPnl: 20, retracement: 0.25, profitFloor: 10 });
  });

  it("maxPnl 15%이면 10% tier를 반환한다", () => {
    const tier = findProfitTier(15);
    expect(tier).toEqual({ minMaxPnl: 10, retracement: 0.30, profitFloor: 3 });
  });

  it("maxPnl 10%이면 10% tier를 반환한다 (경계값)", () => {
    const tier = findProfitTier(10);
    expect(tier).toEqual({ minMaxPnl: 10, retracement: 0.30, profitFloor: 3 });
  });

  it("maxPnl 7%이면 5% tier를 반환한다", () => {
    const tier = findProfitTier(7);
    expect(tier).toEqual({ minMaxPnl: 5, retracement: 0.40, profitFloor: 0 });
  });

  it("maxPnl 5%이면 5% tier를 반환한다 (경계값)", () => {
    const tier = findProfitTier(5);
    expect(tier).toEqual({ minMaxPnl: 5, retracement: 0.40, profitFloor: 0 });
  });

  it.each([
    { maxPnl: 4.9 },
    { maxPnl: 3 },
    { maxPnl: 2 },
  ])("maxPnl $maxPnl%이면 2% tier를 반환한다", ({ maxPnl }) => {
    expect(findProfitTier(maxPnl)).toEqual({ minMaxPnl: 2, retracement: 0.50, profitFloor: 0 });
  });

  it("maxPnl 1.9%이면 null을 반환한다 (tier 미달)", () => {
    expect(findProfitTier(1.9)).toBeNull();
  });

  it("maxPnl 0%이면 null을 반환한다", () => {
    expect(findProfitTier(0)).toBeNull();
  });

  it("maxPnl 음수이면 null을 반환한다", () => {
    expect(findProfitTier(-5)).toBeNull();
  });
});

// =============================================================================
// shouldTriggerTrailingStop — 단계적 이익 실현 테스트
// =============================================================================

describe("shouldTriggerTrailingStop", () => {
  // --- Tier 20%+: 25% 되돌림, floor 10% ---

  it("AAOI 사례: maxPnl 27.4% → pnl -5.7%이면 발동한다", () => {
    // trailingLevel = max(27.4 * 0.75, 10) = 20.55
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 3,
        maxPnlPercent: 27.4,
        pnlPercent: -5.7,
      }),
    ).toBe(true);
  });

  it("maxPnl 27.4%에서 pnl 21%이면 미발동 (level 20.55 위)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 27.4,
        pnlPercent: 21,
      }),
    ).toBe(false);
  });

  it("maxPnl 27.4%에서 pnl 20%이면 발동 (level 20.55 아래)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 27.4,
        pnlPercent: 20,
      }),
    ).toBe(true);
  });

  it("maxPnl 20%에서 profit floor 10%가 binding된다", () => {
    // trailingLevel = max(20 * 0.75, 10) = max(15, 10) = 15
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 20,
        pnlPercent: 14,
      }),
    ).toBe(true);
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 20,
        pnlPercent: 16,
      }),
    ).toBe(false);
  });

  // --- Tier 10%+: 30% 되돌림, floor 3% ---

  it("DWSN 사례: maxPnl 10.9% → pnl -33%이면 발동한다", () => {
    // trailingLevel = max(10.9 * 0.70, 3) = max(7.63, 3) = 7.63
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 10.9,
        pnlPercent: -33,
      }),
    ).toBe(true);
  });

  it("maxPnl 15%에서 pnl 11%이면 미발동 (level 10.5 위)", () => {
    // trailingLevel = max(15 * 0.70, 3) = max(10.5, 3) = 10.5
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 15,
        pnlPercent: 11,
      }),
    ).toBe(false);
  });

  it("maxPnl 15%에서 pnl 10%이면 발동 (level 10.5 아래)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 15,
        pnlPercent: 10,
      }),
    ).toBe(true);
  });

  it("maxPnl 10%에서 profit floor 3%가 적용된다", () => {
    // trailingLevel = max(10 * 0.70, 3) = max(7, 3) = 7
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 10,
        pnlPercent: 6,
      }),
    ).toBe(true);
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 10,
        pnlPercent: 8,
      }),
    ).toBe(false);
  });

  // --- Tier 5%+: 40% 되돌림, floor 0% ---

  it("maxPnl 7%에서 pnl 4%이면 발동 (level 4.2 아래)", () => {
    // trailingLevel = max(7 * 0.60, 0) = 4.2
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 7,
        pnlPercent: 4,
      }),
    ).toBe(true);
  });

  it("maxPnl 7%에서 pnl 5%이면 미발동 (level 4.2 위)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 7,
        pnlPercent: 5,
      }),
    ).toBe(false);
  });

  it("maxPnl 5%에서 profit floor 0%가 적용된다", () => {
    // trailingLevel = max(5 * 0.60, 0) = 3
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 5,
        pnlPercent: 2,
      }),
    ).toBe(true);
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 5,
        pnlPercent: 4,
      }),
    ).toBe(false);
  });

  // --- Tier 2%+: 50% 되돌림, floor 0% (break-even 보호) ---

  it("maxPnl 4%에서 pnl 1%이면 발동 (level 2.0 아래)", () => {
    // trailingLevel = max(4 * 0.50, 0) = 2.0
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 4,
        pnlPercent: 1,
      }),
    ).toBe(true);
  });

  it("maxPnl 4%에서 pnl 3%이면 미발동 (level 2.0 위)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 4,
        pnlPercent: 3,
      }),
    ).toBe(false);
  });

  it("maxPnl 3%에서 pnl 1%이면 발동 (level 1.5 아래)", () => {
    // trailingLevel = max(3 * 0.50, 0) = 1.5
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 3,
        pnlPercent: 1,
      }),
    ).toBe(true);
  });

  it("maxPnl 3%에서 pnl 2%이면 미발동 (level 1.5 위)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 3,
        pnlPercent: 2,
      }),
    ).toBe(false);
  });

  it("maxPnl 2%에서 pnl -1%이면 발동 (손실 전환 방지)", () => {
    // trailingLevel = max(2 * 0.50, 0) = 1.0
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 2,
        pnlPercent: -1,
      }),
    ).toBe(true);
  });

  it("maxPnl 4.9%에서 pnl 2%이면 발동 (level 2.45 아래)", () => {
    // trailingLevel = max(4.9 * 0.50, 0) = 2.45
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 4.9,
        pnlPercent: 2,
      }),
    ).toBe(true);
  });

  // --- No tier (maxPnl < 2%) ---

  it("maxPnl 1.9%이면 미발동 (tier 없음)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 1.9,
        pnlPercent: 0,
      }),
    ).toBe(false);
  });

  it("maxPnl 0%이면 미발동", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 0,
        pnlPercent: -3,
      }),
    ).toBe(false);
  });

  // --- ETL 미완료 ---

  it("currentPhase가 null이면 미발동한다", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: null,
        maxPnlPercent: 30,
        pnlPercent: 5,
      }),
    ).toBe(false);
  });

  // --- PROFIT_TIERS 상수 검증 ---

  it("PROFIT_TIERS가 minMaxPnl 내림차순이다", () => {
    for (let i = 1; i < PROFIT_TIERS.length; i++) {
      expect(PROFIT_TIERS[i - 1].minMaxPnl).toBeGreaterThan(PROFIT_TIERS[i].minMaxPnl);
    }
  });

  it("PROFIT_TIERS 길이가 4이다", () => {
    expect(PROFIT_TIERS).toHaveLength(4);
  });
});

// =============================================================================
// formatTrailingStopReason — closeReason 포맷 테스트
// =============================================================================

describe("formatTrailingStopReason", () => {
  it("20%+ tier에서 tier 정보를 포함한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 27.4, pnlPercent: 18 });
    expect(reason).toContain("tier 20%+");
    expect(reason).toContain("25%");
    expect(reason).toContain("floor 10%");
  });

  it("10%+ tier에서 tier 정보를 포함한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 15, pnlPercent: 8 });
    expect(reason).toContain("tier 10%+");
    expect(reason).toContain("30%");
    expect(reason).toContain("floor 3%");
  });

  it("5%+ tier에서 tier 정보를 포함한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 7, pnlPercent: 3 });
    expect(reason).toContain("tier 5%+");
    expect(reason).toContain("40%");
    expect(reason).toContain("floor 0%");
  });

  it("2%+ tier에서 tier 정보를 포함한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 3, pnlPercent: 1 });
    expect(reason).toContain("tier 2%+");
    expect(reason).toContain("50%");
    expect(reason).toContain("floor 0%");
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
