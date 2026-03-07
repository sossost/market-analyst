import { describe, it, expect } from "vitest";
import { buildPromotionCandidates } from "@/etl/jobs/promote-learnings";

/**
 * 장기 기억 승격/강등 로직의 핵심: 만료 판정 + 적중률 계산 + 승격 후보 생성.
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

function makeThesis(overrides: Record<string, unknown>) {
  return {
    id: 1,
    debateDate: "2026-03-01",
    agentPersona: "macro",
    thesis: "test thesis",
    timeframeDays: 30,
    verificationMetric: "S&P 500",
    targetCondition: ">5800",
    invalidationCondition: null,
    confidence: "high",
    consensusLevel: "3/4",
    status: "CONFIRMED",
    verificationDate: "2026-03-05",
    verificationResult: "confirmed",
    closeReason: "condition_met",
    verificationMethod: "quantitative",
    causalAnalysis: null,
    createdAt: new Date(),
    ...overrides,
  } as any;
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

  describe("buildPromotionCandidates", () => {
    it("promotes group with 10+ confirmed, 70%+ hitRate, 10+ observations", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "Fed funds rate" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(1);
      expect(result[0].persona).toBe("macro");
      expect(result[0].metric).toBe("Fed funds rate");
      expect(result[0].hitCount).toBe(10);
    });

    it("excludes groups with fewer than 10 confirmed", () => {
      const confirmed = Array.from({ length: 9 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "GDP" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(0);
    });

    it("excludes groups with hitRate below 70%", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
      );
      // 10 confirmed + 5 invalidated = 66.7% hitRate < 70%
      const invalidated = Array.from({ length: 5 }, (_, i) =>
        makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "CPI", status: "INVALIDATED" }),
      );

      const result = buildPromotionCandidates(confirmed, invalidated, new Set());
      expect(result).toHaveLength(0);
    });

    it("excludes groups with 71% hitRate but insufficient statistical significance (10/14)", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
      );
      // 10 confirmed + 4 invalidated = 71.4% hitRate — 기존 기준은 통과하지만
      // 이항분포 검정에서 p=0.09 > 0.05이므로 통계적으로 유의하지 않음
      const invalidated = Array.from({ length: 4 }, (_, i) =>
        makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "CPI", status: "INVALIDATED" }),
      );

      const result = buildPromotionCandidates(confirmed, invalidated, new Set());
      expect(result).toHaveLength(0);
    });

    it("includes groups with high hitRate and statistical significance (10/0)", () => {
      // 10 confirmed + 0 invalidated = 100% → p ≈ 0.001, Cohen's h ≈ 1.57
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(1);
      expect(result[0].hitCount).toBe(10);
      expect(result[0].missCount).toBe(0);
    });

    it("excludes thesis IDs already in existing learnings", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "tech", verificationMetric: "capex" }),
      );

      const existingIds = new Set(Array.from({ length: 10 }, (_, i) => i + 1));
      const result = buildPromotionCandidates(confirmed, [], existingIds);
      expect(result).toHaveLength(0);
    });

    it("counts invalidated theses for the same group", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "sentiment", verificationMetric: "VIX" }),
      );
      const invalidated = [
        makeThesis({ id: 100, agentPersona: "sentiment", verificationMetric: "VIX", status: "INVALIDATED" }),
      ];

      const result = buildPromotionCandidates(confirmed, invalidated, new Set());
      expect(result).toHaveLength(1);
      expect(result[0].hitCount).toBe(10);
      expect(result[0].missCount).toBe(1);
      expect(result[0].invalidatedIds).toEqual([100]);
    });

    it("handles multiple groups from different personas", () => {
      const confirmed = [
        ...Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: 100 + i, agentPersona: "tech", verificationMetric: "AI capex" }),
        ),
      ];

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(2);
    });

    it("returns empty for no confirmed theses", () => {
      const result = buildPromotionCandidates([], [], new Set());
      expect(result).toHaveLength(0);
    });

    it("collects verificationMethods from source theses", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({
          id: i + 1,
          agentPersona: "macro",
          verificationMetric: "GDP",
          verificationMethod: i < 7 ? "quantitative" : "llm",
        }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(1);
      expect(result[0].verificationMethods).toContain("quantitative");
      expect(result[0].verificationMethods).toContain("llm");
      expect(result[0].verificationMethods).toHaveLength(2);
    });

    it("returns single verificationMethod when all theses use the same method", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({
          id: i + 1,
          agentPersona: "macro",
          verificationMetric: "CPI",
          verificationMethod: "quantitative",
        }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(1);
      expect(result[0].verificationMethods).toEqual(["quantitative"]);
    });

    it("returns empty verificationMethods when theses have no verificationMethod", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({
          id: i + 1,
          agentPersona: "macro",
          verificationMetric: "VIX",
          verificationMethod: null,
        }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(1);
      expect(result[0].verificationMethods).toEqual([]);
    });

    it("does not include reusablePatterns in candidate", () => {
      const confirmed = Array.from({ length: 10 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "GDP" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set());
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty("reusablePatterns");
    });
  });
});
