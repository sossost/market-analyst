import { describe, it, expect } from "vitest";
import { detectPhase, calculateMa150Slope } from "../phase-detection";
import type { PhaseInput } from "@/types";

/**
 * Phase 2 판정 로직 단위 테스트.
 * PHASE_2_MIN_CONDITIONS = 7 (6에서 강화, #376)
 */

function makePhase2Input(overrides?: Partial<PhaseInput>): PhaseInput {
  // 기본: 8/8 조건 모두 충족하는 확정 Phase 2
  return {
    price: 150,
    ma50: 140,
    ma150: 130,
    ma200: 120,
    ma150_20dAgo: 125,   // slope positive
    rsScore: 70,
    high52w: 160,        // price within 25% of high (150 >= 160*0.75=120)
    low52w: 100,         // price > 30% above low (150 > 100*1.3=130)
    ...overrides,
  };
}

describe("calculateMa150Slope", () => {
  it("정상적인 양의 기울기를 계산한다", () => {
    expect(calculateMa150Slope(130, 125)).toBeCloseTo(0.04, 4);
  });

  it("음의 기울기를 계산한다", () => {
    expect(calculateMa150Slope(120, 130)).toBeCloseTo(-0.0769, 3);
  });

  it("ma150_20dAgo가 0이면 0을 반환한다", () => {
    expect(calculateMa150Slope(130, 0)).toBe(0);
  });
});

describe("detectPhase — Phase 2 판정", () => {
  it("8/8 조건 충족 시 Phase 2를 반환한다", () => {
    const result = detectPhase(makePhase2Input());
    expect(result.phase).toBe(2);
    expect(result.detail.phase2ConditionsMet).toBe(8);
  });

  it("7/8 조건 충족 (RS <= 50 미충족) 시 Phase 2를 반환한다", () => {
    const result = detectPhase(makePhase2Input({ rsScore: 45 }));
    expect(result.phase).toBe(2);
    expect(result.detail.phase2ConditionsMet).toBe(7);
  });

  it("6/8 조건 충족 시 Phase 2가 아니다 (7/8 기준 미달)", () => {
    // RS <= 50 미충족 + MA50 < MA150 → 6/8
    const result = detectPhase(makePhase2Input({ rsScore: 45, ma50: 125 }));
    expect(result.phase).not.toBe(2);
    expect(result.detail.phase2ConditionsMet).toBe(6);
  });

  it("Core 3조건 중 price <= MA150이면 Phase 2가 아니다", () => {
    const result = detectPhase(makePhase2Input({ price: 125 }));
    expect(result.phase).not.toBe(2);
  });

  it("Core 3조건 중 MA150 <= MA200이면 Phase 2가 아니다", () => {
    const result = detectPhase(makePhase2Input({ ma200: 135 }));
    expect(result.phase).not.toBe(2);
  });

  it("Core 3조건 중 slope <= 0이면 Phase 2가 아니다", () => {
    // ma150_20dAgo > ma150Today → negative slope
    const result = detectPhase(makePhase2Input({ ma150_20dAgo: 135 }));
    expect(result.phase).not.toBe(2);
  });
});

describe("detectPhase — Phase 1, 3, 4 판정", () => {
  it("Phase 4: price < MA150, MA150 < MA200, slope negative, RS < 50", () => {
    const result = detectPhase({
      price: 90,
      ma50: 95,
      ma150: 100,
      ma200: 110,
      ma150_20dAgo: 105,
      rsScore: 30,
      high52w: 150,
      low52w: 80,
    });
    expect(result.phase).toBe(4);
  });

  it("Phase 3 (distribution): price <= MA150 but MA150 > MA200", () => {
    const result = detectPhase({
      price: 125,
      ma50: 130,
      ma150: 130,
      ma200: 120,
      ma150_20dAgo: 128,
      rsScore: 60,
      high52w: 160,
      low52w: 100,
    });
    expect(result.phase).toBe(3);
  });

  it("Phase 1: MA150 flat, price near MA150", () => {
    const result = detectPhase({
      price: 100,
      ma50: 99,
      ma150: 100,
      ma200: 105,
      ma150_20dAgo: 99.5,  // flat slope (~0.5%)
      rsScore: 45,
      high52w: 130,
      low52w: 80,
    });
    expect(result.phase).toBe(1);
  });
});
