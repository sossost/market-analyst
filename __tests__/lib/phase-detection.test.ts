import { describe, it, expect } from "vitest";
import { detectPhase, calculateMa150Slope } from "@/lib/phase-detection";
import type { PhaseInput } from "@/types";

/**
 * Weinstein Phase 2 conditions (all must be true):
 * 1. price > MA150
 * 2. price > MA200
 * 3. MA150 > MA200
 * 4. MA50 > MA150
 * 5. MA150 slope > 0 (rising)
 * 6. RS score > 50
 * 7. price > 30% above 52-week low
 * 8. price within 25% of 52-week high
 */

function makePhase2Input(overrides: Partial<PhaseInput> = {}): PhaseInput {
  return {
    price: 150,
    ma50: 145,
    ma150: 135,
    ma200: 120,
    ma150_20dAgo: 130,
    rsScore: 75,
    high52w: 160,
    low52w: 80,
    ...overrides,
  };
}

describe("calculateMa150Slope", () => {
  it("returns positive slope when MA150 is rising", () => {
    const slope = calculateMa150Slope(135, 130);
    expect(slope).toBeCloseTo(0.03846, 4);
  });

  it("returns negative slope when MA150 is falling", () => {
    const slope = calculateMa150Slope(120, 130);
    expect(slope).toBeCloseTo(-0.07692, 4);
  });

  it("returns zero when MA150 is flat", () => {
    const slope = calculateMa150Slope(130, 130);
    expect(slope).toBe(0);
  });

  it("handles small values without division issues", () => {
    const slope = calculateMa150Slope(0.5, 0.4);
    expect(slope).toBeCloseTo(0.25, 4);
  });
});

describe("detectPhase", () => {
  describe("Phase 2 detection", () => {
    it("returns Phase 2 when all 8 conditions are met", () => {
      const input = makePhase2Input();
      const result = detectPhase(input);

      expect(result.phase).toBe(2);
      expect(result.detail.conditionsMet).toHaveLength(8);
    });

    it("includes all 8 condition labels when Phase 2", () => {
      const result = detectPhase(makePhase2Input());

      expect(result.detail.priceAboveMa150).toBe(true);
      expect(result.detail.priceAboveMa200).toBe(true);
      expect(result.detail.ma150AboveMa200).toBe(true);
      expect(result.detail.ma50AboveMa150).toBe(true);
      expect(result.detail.ma150SlopePositive).toBe(true);
      expect(result.detail.rsAbove50).toBe(true);
      expect(result.detail.priceAbove30PctFromLow).toBe(true);
      expect(result.detail.priceWithin25PctOfHigh).toBe(true);
    });

    it("reports ma150Slope in result", () => {
      const result = detectPhase(makePhase2Input());
      expect(result.ma150Slope).toBeGreaterThan(0);
    });

    it("fails Phase 2 when price < MA150", () => {
      const result = detectPhase(makePhase2Input({ price: 130 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.priceAboveMa150).toBe(false);
    });

    it("fails Phase 2 when price < MA200", () => {
      const result = detectPhase(makePhase2Input({ price: 115 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.priceAboveMa200).toBe(false);
    });

    it("fails Phase 2 when MA150 < MA200", () => {
      const result = detectPhase(makePhase2Input({ ma150: 115, ma200: 120 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.ma150AboveMa200).toBe(false);
    });

    it("fails Phase 2 when MA50 < MA150", () => {
      const result = detectPhase(makePhase2Input({ ma50: 130 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.ma50AboveMa150).toBe(false);
    });

    it("fails Phase 2 when MA150 slope is negative", () => {
      const result = detectPhase(makePhase2Input({ ma150_20dAgo: 140 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.ma150SlopePositive).toBe(false);
    });

    it("fails Phase 2 when RS < 50", () => {
      const result = detectPhase(makePhase2Input({ rsScore: 40 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.rsAbove50).toBe(false);
    });

    it("fails Phase 2 when price is not 30% above 52w low", () => {
      // price = 150, low52w needs to be high enough so 150 < low52w * 1.3
      const result = detectPhase(makePhase2Input({ low52w: 120 }));
      // 120 * 1.3 = 156, price=150 < 156 → fails
      expect(result.phase).not.toBe(2);
      expect(result.detail.priceAbove30PctFromLow).toBe(false);
    });

    it("fails Phase 2 when price is more than 25% below 52w high", () => {
      // price = 150, high52w * 0.75 = threshold
      // high52w = 250 → 250*0.75 = 187.5, price=150 < 187.5 → fails
      const result = detectPhase(makePhase2Input({ high52w: 250 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.priceWithin25PctOfHigh).toBe(false);
    });
  });

  describe("Phase 4 detection (markdown/decline)", () => {
    it("returns Phase 4 when price below MA150, slope negative, RS low", () => {
      const result = detectPhase({
        price: 80,
        ma50: 90,
        ma150: 100,
        ma200: 105,
        ma150_20dAgo: 110,
        rsScore: 20,
        high52w: 150,
        low52w: 70,
      });

      expect(result.phase).toBe(4);
    });

    it("returns Phase 4 when MA150 below MA200 and falling", () => {
      const result = detectPhase({
        price: 85,
        ma50: 88,
        ma150: 95,
        ma200: 100,
        ma150_20dAgo: 102,
        rsScore: 30,
        high52w: 140,
        low52w: 75,
      });

      expect(result.phase).toBe(4);
    });

    it("classifies as Phase 4 when price slightly below ma150 with weak negative slope", () => {
      // slope가 flat 범위(-0.015)이고 price가 ma150 아주 살짝 아래인 경우
      // Phase 4 조건(price < ma150, ma150 < ma200, slope < 0)을 모두 충족하므로 Phase 4
      const input: PhaseInput = {
        price: 99,
        ma50: 95,
        ma150: 100,
        ma200: 105,
        ma150_20dAgo: 101.5, // slope ≈ -0.0148
        rsScore: 49,
        high52w: 150,
        low52w: 80,
      };
      const result = detectPhase(input);
      expect(result.phase).toBe(4);
    });
  });

  describe("Phase 1 detection (base/accumulation)", () => {
    it("returns Phase 1 when MA150 is flat and price near MA150 (price above MA150)", () => {
      // price > ma150 → Phase 4의 price < ma150 조건 불충족 → Phase 1로 판정
      const result = detectPhase({
        price: 102,
        ma50: 99,
        ma150: 101,
        ma200: 103,
        ma150_20dAgo: 101.5, // nearly flat slope: (101 - 101.5) / 101.5 = -0.0049 (flat 범위)
        rsScore: 45,
        high52w: 130,
        low52w: 85,
      });

      expect(result.phase).toBe(1);
    });

    it("returns Phase 1 when price oscillates around flat MA150", () => {
      const result = detectPhase({
        price: 102,
        ma50: 100,
        ma150: 101,
        ma200: 102,
        ma150_20dAgo: 100.5, // very slight rise: slope positive → Phase 4 조건 slope < 0 불충족
        rsScore: 48,
        high52w: 125,
        low52w: 88,
      });

      expect(result.phase).toBe(1);
    });
  });

  describe("Phase 4 priority over Phase 1", () => {
    it("classifies as Phase 4 when both Phase 1 and Phase 4 conditions overlap", () => {
      // MA150 slope가 flat(-0.02 이내)이면서 가격이 MA150 근처(5% 이내)이지만,
      // 동시에 price < MA150, MA150 < MA200, slope < 0, RS < 50인 경우 Phase 4 우선
      const input: PhaseInput = {
        price: 98, // MA150(100)의 2% 이내 → priceNearMa150 충족
        ma50: 95,
        ma150: 100,
        ma200: 105, // MA150 < MA200 → Phase 4 조건 충족
        ma150_20dAgo: 101.5, // slope = (100 - 101.5) / 101.5 = -0.0148: flat 범위이면서 음수 → slopeFlat 충족 + slope < 0
        rsScore: 35, // RS < 50 → Phase 4 조건 충족
        high52w: 150,
        low52w: 80,
      };
      const result = detectPhase(input);
      // Phase 1 조건(slopeFlat + priceNearMa150)도 충족하지만 Phase 4가 우선
      expect(result.phase).toBe(4);
    });

    it("classifies as Phase 1 when Phase 4 price condition is not met (price above MA150)", () => {
      // price > MA150 이면 Phase 4 조건(price < MA150) 불충족 → Phase 1로 분류
      const input: PhaseInput = {
        price: 103, // price > MA150(100) → Phase 4 price 조건 불충족
        ma50: 100,
        ma150: 100,
        ma200: 105,
        ma150_20dAgo: 101.5, // slope: -0.0148 (flat 범위)
        rsScore: 35,
        high52w: 150,
        low52w: 80,
      };
      const result = detectPhase(input);
      expect(result.phase).toBe(1);
    });
  });

  describe("Phase 3 detection (distribution/top)", () => {
    it("returns Phase 3 as default when not Phase 1/2/4", () => {
      // Price well above MA150 (not near → not Phase 1)
      // MA150 declining but above MA200, RS > 50 (not Phase 4)
      // Missing Phase 2 conditions (slope negative)
      const result = detectPhase({
        price: 130,
        ma50: 125,
        ma150: 115,
        ma200: 110,
        ma150_20dAgo: 120, // clearly declining slope (-4.2%)
        rsScore: 55,
        high52w: 155,
        low52w: 80,
      });

      expect(result.phase).toBe(3);
    });
  });

  describe("boundary values", () => {
    it("RS exactly 50 does not qualify for Phase 2", () => {
      const result = detectPhase(makePhase2Input({ rsScore: 50 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.rsAbove50).toBe(false);
    });

    it("RS 51 qualifies for Phase 2 rs condition", () => {
      const result = detectPhase(makePhase2Input({ rsScore: 51 }));
      expect(result.detail.rsAbove50).toBe(true);
    });

    it("MA150 slope at exactly 0 is not positive", () => {
      const result = detectPhase(
        makePhase2Input({ ma150: 130, ma150_20dAgo: 130 }),
      );
      expect(result.detail.ma150SlopePositive).toBe(false);
    });

    it("price exactly at MA150 does not qualify as above", () => {
      const result = detectPhase(makePhase2Input({ price: 135 }));
      expect(result.detail.priceAboveMa150).toBe(false);
    });

    it("price exactly 30% above low qualifies", () => {
      // low52w = 100, price = 130 → exactly 30% above → should pass
      const result = detectPhase(
        makePhase2Input({ price: 150, low52w: 115 }),
      );
      // 115 * 1.3 = 149.5, price=150 > 149.5 → passes
      expect(result.detail.priceAbove30PctFromLow).toBe(true);
    });
  });
});
