import { describe, it, expect } from "vitest";
import {
  calculateMaxAdverseMove,
  calculateDaysBetween,
  isPhase2Reverted,
} from "@/etl/jobs/track-phase-exits";

describe("track-phase-exits logic", () => {
  describe("calculateMaxAdverseMove", () => {
    it("calculates correct adverse move percentage", () => {
      // 진입가 100, 최저가 90 → 10% 역행
      expect(calculateMaxAdverseMove(100, 90)).toBeCloseTo(10);
    });

    it("returns 0 when no adverse move (low >= entry)", () => {
      expect(calculateMaxAdverseMove(100, 110)).toBe(0);
    });

    it("returns 0 when entry price is 0", () => {
      expect(calculateMaxAdverseMove(0, 50)).toBe(0);
    });

    it("returns 0 when entry price is negative", () => {
      expect(calculateMaxAdverseMove(-10, 50)).toBe(0);
    });

    it("returns 0 when low equals entry", () => {
      expect(calculateMaxAdverseMove(100, 100)).toBe(0);
    });

    it("handles large adverse moves", () => {
      // 진입가 200, 최저가 100 → 50% 역행
      expect(calculateMaxAdverseMove(200, 100)).toBeCloseTo(50);
    });

    it("handles small adverse moves", () => {
      // 진입가 100, 최저가 99.5 → 0.5% 역행
      expect(calculateMaxAdverseMove(100, 99.5)).toBeCloseTo(0.5);
    });
  });

  describe("calculateDaysBetween", () => {
    it("calculates correct day difference", () => {
      expect(calculateDaysBetween("2026-03-01", "2026-03-08")).toBe(7);
    });

    it("returns 0 for same date", () => {
      expect(calculateDaysBetween("2026-03-01", "2026-03-01")).toBe(0);
    });

    it("returns 0 when end is before start", () => {
      expect(calculateDaysBetween("2026-03-08", "2026-03-01")).toBe(0);
    });

    it("handles month boundaries", () => {
      expect(calculateDaysBetween("2026-02-28", "2026-03-01")).toBe(1);
    });

    it("handles year boundaries", () => {
      expect(calculateDaysBetween("2025-12-31", "2026-01-01")).toBe(1);
    });

    it("handles long durations", () => {
      expect(calculateDaysBetween("2026-01-01", "2026-04-01")).toBe(90);
    });
  });

  describe("isPhase2Reverted", () => {
    it("returns true for Phase 1 (회귀)", () => {
      expect(isPhase2Reverted(1)).toBe(true);
    });

    it("returns true for Phase 4 (하락)", () => {
      expect(isPhase2Reverted(4)).toBe(true);
    });

    it("returns false for Phase 2 (유지)", () => {
      expect(isPhase2Reverted(2)).toBe(false);
    });

    it("returns false for Phase 3 (자연 진행)", () => {
      expect(isPhase2Reverted(3)).toBe(false);
    });

    it("returns false for null phase", () => {
      expect(isPhase2Reverted(null)).toBe(false);
    });
  });
});
