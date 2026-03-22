import { describe, it, expect } from "vitest";
import { detectPhase, calculateMa150Slope } from "@/lib/phase-detection";
import type { PhaseInput } from "@/types";

/**
 * Weinstein Phase 2 conditions (all must be true for full confirmation):
 * 1. price > MA150
 * 2. price > MA200
 * 3. MA150 > MA200
 * 4. MA50 > MA150
 * 5. MA150 slope > 0 (rising)
 * 6. RS score > 50
 * 7. price > 30% above 52-week low
 * 8. price within 25% of 52-week high
 *
 * Phase 2 판정: Core 3개(price > MA150, MA150 > MA200, slope > 0) + 총 7/8 이상 (#376)
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

  it("returns 0 when ma150_20dAgo is 0 (division guard)", () => {
    expect(calculateMa150Slope(130, 0)).toBe(0);
  });
});

describe("detectPhase", () => {
  describe("Phase 2 detection", () => {
    it("returns Phase 2 when all 8 conditions are met", () => {
      const input = makePhase2Input();
      const result = detectPhase(input);

      expect(result.phase).toBe(2);
      expect(result.detail.conditionsMet).toHaveLength(8);
      expect(result.detail.phase2ConditionsMet).toBe(8);
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

    it("returns Phase 2 with 7/8 conditions (missing MA50 > MA150)", () => {
      // Core conditions met: price > MA150, MA150 > MA200, slope positive
      // Missing: MA50 > MA150 only → 7/8 → Phase 2 early
      const result = detectPhase(makePhase2Input({ ma50: 130 }));
      expect(result.phase).toBe(2);
      expect(result.detail.phase2ConditionsMet).toBe(7);
      expect(result.detail.ma50AboveMa150).toBe(false);
    });

    it("returns Phase 2 with 7/8 conditions (missing RS > 50)", () => {
      const result = detectPhase(makePhase2Input({ rsScore: 40 }));
      expect(result.phase).toBe(2);
      expect(result.detail.phase2ConditionsMet).toBe(7);
      expect(result.detail.rsAbove50).toBe(false);
    });

    it("does NOT return Phase 2 with 6/8 conditions (7/8 minimum required, #376)", () => {
      // Missing: MA50 > MA150 and RS > 50 → 6/8
      const result = detectPhase(makePhase2Input({ ma50: 130, rsScore: 40 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.phase2ConditionsMet).toBe(6);
    });

    it("does NOT return Phase 2 with 5/8 conditions", () => {
      // Missing: MA50 > MA150, RS > 50, price not 30% above low → 5/8
      const result = detectPhase(
        makePhase2Input({ ma50: 130, rsScore: 40, low52w: 120 }),
      );
      expect(result.phase).not.toBe(2);
      expect(result.detail.phase2ConditionsMet).toBe(5);
    });

    it("does NOT return Phase 2 when core condition price > MA150 fails", () => {
      // 7/8 but missing core: price <= MA150
      const result = detectPhase(makePhase2Input({ price: 130 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.priceAboveMa150).toBe(false);
    });

    it("does NOT return Phase 2 when core condition MA150 > MA200 fails", () => {
      // MA150 < MA200 → core condition fails
      const result = detectPhase(makePhase2Input({ ma150: 115, ma200: 120 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.ma150AboveMa200).toBe(false);
    });

    it("does NOT return Phase 2 when core condition slope positive fails", () => {
      // slope negative → core condition fails
      const result = detectPhase(makePhase2Input({ ma150_20dAgo: 140 }));
      expect(result.phase).not.toBe(2);
      expect(result.detail.ma150SlopePositive).toBe(false);
    });

    it("returns Phase 2 even when price is not 30% above 52w low", () => {
      // price = 150, low52w needs to be high enough so 150 < low52w * 1.3
      const result = detectPhase(makePhase2Input({ low52w: 120 }));
      // 120 * 1.3 = 156, price=150 < 156 → fails this condition but 7/8 → still Phase 2
      expect(result.phase).toBe(2);
      expect(result.detail.priceAbove30PctFromLow).toBe(false);
      expect(result.detail.phase2ConditionsMet).toBe(7);
    });

    it("returns Phase 2 even when price is more than 25% below 52w high", () => {
      // high52w = 250 → 250*0.75 = 187.5, price=150 < 187.5 → fails
      const result = detectPhase(makePhase2Input({ high52w: 250 }));
      // 7/8 conditions → still Phase 2
      expect(result.phase).toBe(2);
      expect(result.detail.priceWithin25PctOfHigh).toBe(false);
      expect(result.detail.phase2ConditionsMet).toBe(7);
    });
  });

  describe("Phase 2 early detection (issue #328 fix)", () => {
    it("captures 7/8 stock that was previously misclassified as Phase 3", () => {
      // Classic Phase 2 transitioning: all conditions met except MA50 hasn't crossed MA150 yet
      const result = detectPhase({
        price: 150,
        ma50: 130, // MA50 still below MA150 — lagging indicator
        ma150: 135,
        ma200: 120,
        ma150_20dAgo: 130,
        rsScore: 75,
        high52w: 160,
        low52w: 80,
      });
      expect(result.phase).toBe(2);
      expect(result.detail.phase2ConditionsMet).toBe(7);
    });

    it("does NOT capture Phase 1 → Phase 2 transition with only 6/8 conditions (#376)", () => {
      // Emerging from base: core structural conditions met, but RS and MA50 still catching up
      // 6/8 is no longer sufficient — must meet 7/8 minimum
      const result = detectPhase({
        price: 140,
        ma50: 130, // below MA150
        ma150: 135,
        ma200: 130,
        ma150_20dAgo: 133, // slope positive
        rsScore: 45, // RS still below 50
        high52w: 160,
        low52w: 80,
      });
      expect(result.phase).not.toBe(2);
      expect(result.detail.phase2ConditionsMet).toBe(6);
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
    it("returns Phase 1 when MA150 is flat and price near MA150 with MA150 <= MA200", () => {
      // Phase 1 requires MA150 <= MA200 (otherwise it's Phase 3 distribution)
      const result = detectPhase({
        price: 102,
        ma50: 99,
        ma150: 101,
        ma200: 103, // MA150 < MA200 → not distribution
        ma150_20dAgo: 101.5, // nearly flat slope
        rsScore: 45,
        high52w: 130,
        low52w: 85,
      });

      expect(result.phase).toBe(1);
    });

    it("returns Phase 1 when price oscillates around flat MA150 with MA150 ≈ MA200", () => {
      const result = detectPhase({
        price: 102,
        ma50: 100,
        ma150: 101,
        ma200: 102,
        ma150_20dAgo: 100.5,
        rsScore: 48,
        high52w: 125,
        low52w: 88,
      });

      expect(result.phase).toBe(1);
    });
  });

  describe("Phase 3 distribution guard (issue #328 fix)", () => {
    it("classifies as Phase 3 when price ≤ MA150 and MA150 > MA200 (distribution)", () => {
      // This was previously misclassified as Phase 1 when slope was flat
      const result = detectPhase({
        price: 98, // price < MA150
        ma50: 95,
        ma150: 100,
        ma200: 95, // MA150 > MA200 → was in Phase 2, now topping
        ma150_20dAgo: 100.5, // slope flat
        rsScore: 55,
        high52w: 120,
        low52w: 70,
      });

      expect(result.phase).toBe(3);
    });

    it("classifies as Phase 3 not Phase 1 when MA150 > MA200 with flat slope and price near MA150", () => {
      // Exact scenario from issue #328: Phase 3 → Phase 1 misclassification
      const result = detectPhase({
        price: 99, // within 5% of MA150(100) → priceNearMa150 = true
        ma50: 97,
        ma150: 100,
        ma200: 95, // MA150 > MA200
        ma150_20dAgo: 101, // slope ≈ -0.0099 → flat range
        rsScore: 45,
        high52w: 130,
        low52w: 70,
      });

      // Should be Phase 3 (distribution), NOT Phase 1
      expect(result.phase).toBe(3);
    });

    it("still classifies as Phase 1 when MA150 ≤ MA200 (genuine base)", () => {
      // RS >= 50 to avoid Phase 4, slope flat, price near MA150, MA150 < MA200
      const result = detectPhase({
        price: 99,
        ma50: 97,
        ma150: 100,
        ma200: 102, // MA150 < MA200 → genuine base building
        ma150_20dAgo: 100.5, // slope ≈ -0.005 → flat range
        rsScore: 50, // RS >= 50 → not Phase 4
        high52w: 130,
        low52w: 70,
      });

      expect(result.phase).toBe(1);
    });
  });

  describe("Phase 4 priority over Phase 1", () => {
    it("classifies as Phase 4 when both Phase 1 and Phase 4 conditions overlap", () => {
      const input: PhaseInput = {
        price: 98,
        ma50: 95,
        ma150: 100,
        ma200: 105,
        ma150_20dAgo: 101.5, // slope ≈ -0.0148
        rsScore: 35,
        high52w: 150,
        low52w: 80,
      };
      const result = detectPhase(input);
      expect(result.phase).toBe(4);
    });

    it("classifies as Phase 1 when Phase 4 price condition is not met (price above MA150)", () => {
      const input: PhaseInput = {
        price: 103,
        ma50: 100,
        ma150: 100,
        ma200: 105,
        ma150_20dAgo: 101.5,
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
    it("RS exactly 50 does not qualify for Phase 2 RS condition", () => {
      const result = detectPhase(makePhase2Input({ rsScore: 50 }));
      // 7/8 conditions → still Phase 2 (core conditions met)
      expect(result.phase).toBe(2);
      expect(result.detail.rsAbove50).toBe(false);
      expect(result.detail.phase2ConditionsMet).toBe(7);
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
      const result = detectPhase(
        makePhase2Input({ price: 150, low52w: 115 }),
      );
      // 115 * 1.3 = 149.5, price=150 > 149.5 → passes
      expect(result.detail.priceAbove30PctFromLow).toBe(true);
    });

    it("phase2ConditionsMet is always set correctly", () => {
      const result = detectPhase(makePhase2Input());
      expect(result.detail.phase2ConditionsMet).toBe(8);

      const result2 = detectPhase(makePhase2Input({ rsScore: 30, ma50: 100 }));
      expect(result2.detail.phase2ConditionsMet).toBe(6);
    });
  });
});
