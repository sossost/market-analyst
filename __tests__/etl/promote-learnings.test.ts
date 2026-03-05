import { describe, it, expect } from "vitest";

/**
 * 장기 기억 승격/강등 로직의 핵심: 만료 판정 + 적중률 계산.
 * DB 의존 없이 순수 로직만 테스트.
 */

function isLearningExpired(
  expiresAt: string | null,
  lastVerified: string | null,
  today: string,
  expiryMonths: number = 6,
): boolean {
  if (expiresAt != null && expiresAt <= today) return true;

  if (lastVerified != null) {
    const threshold = new Date(today);
    threshold.setMonth(threshold.getMonth() - expiryMonths);
    return lastVerified < threshold.toISOString().slice(0, 10);
  }

  return false;
}

function calculateHitRate(hits: number, misses: number): number | null {
  const total = hits + misses;
  if (total === 0) return null;
  return hits / total;
}

describe("promote-learnings logic", () => {
  describe("isLearningExpired", () => {
    it("not expired when expiresAt is in the future", () => {
      expect(isLearningExpired("2026-12-01", "2026-03-01", "2026-03-05")).toBe(false);
    });

    it("expired when expiresAt is past", () => {
      expect(isLearningExpired("2026-03-01", "2026-02-01", "2026-03-05")).toBe(true);
    });

    it("expired when lastVerified is older than 6 months", () => {
      expect(isLearningExpired(null, "2025-08-01", "2026-03-05")).toBe(true);
    });

    it("not expired when lastVerified is within 6 months", () => {
      expect(isLearningExpired(null, "2025-10-01", "2026-03-05")).toBe(false);
    });

    it("not expired with no dates", () => {
      expect(isLearningExpired(null, null, "2026-03-05")).toBe(false);
    });
  });

  describe("calculateHitRate", () => {
    it("returns null for zero observations", () => {
      expect(calculateHitRate(0, 0)).toBeNull();
    });

    it("calculates correct rate", () => {
      expect(calculateHitRate(3, 1)).toBeCloseTo(0.75);
    });

    it("returns 1.0 for all hits", () => {
      expect(calculateHitRate(5, 0)).toBe(1.0);
    });

    it("returns 0 for all misses", () => {
      expect(calculateHitRate(0, 3)).toBe(0);
    });
  });
});
