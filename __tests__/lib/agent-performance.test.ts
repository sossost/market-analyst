import { describe, it, expect } from "vitest";
import {
  calculateAgentPerformance,
  summarizePerformance,
} from "@/lib/agent-performance";
import type { ThesisRow } from "@/lib/agent-performance";

function makeThesis(overrides: Partial<ThesisRow> = {}): ThesisRow {
  return {
    agentPersona: "macro",
    confidence: "high",
    consensusLevel: "4/4",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("calculateAgentPerformance", () => {
  it("returns empty array for empty input", () => {
    const result = calculateAgentPerformance([]);
    expect(result).toEqual([]);
  });

  it("calculates stats for a single persona (no dedup fields → legacy behavior)", () => {
    const theses: ThesisRow[] = [
      makeThesis({ status: "CONFIRMED" }),
      makeThesis({ status: "CONFIRMED" }),
      makeThesis({ status: "INVALIDATED" }),
      makeThesis({ status: "ACTIVE" }),
      makeThesis({ status: "EXPIRED" }),
    ];

    const result = calculateAgentPerformance(theses);

    expect(result).toHaveLength(1);
    expect(result[0].persona).toBe("macro");
    expect(result[0].total).toBe(5);
    expect(result[0].confirmed).toBe(2);
    expect(result[0].invalidated).toBe(1);
    expect(result[0].expired).toBe(1);
    expect(result[0].active).toBe(1);
    // hitRate = 2 / (2 + 1 + 1) = 0.5  (EXPIRED included in denominator)
    expect(result[0].hitRate).toBeCloseTo(0.5, 3);
  });

  it("calculates stats for 4 personas mixed", () => {
    const theses: ThesisRow[] = [
      // macro: 3 confirmed, 1 invalidated → 75%
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "INVALIDATED" }),

      // tech: 1 confirmed, 2 invalidated → 33%
      makeThesis({ agentPersona: "tech", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "tech", status: "INVALIDATED" }),
      makeThesis({ agentPersona: "tech", status: "INVALIDATED" }),

      // geopolitics: 2 confirmed, 0 invalidated → 100%
      makeThesis({ agentPersona: "geopolitics", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "geopolitics", status: "CONFIRMED" }),

      // sentiment: 0 confirmed, 3 invalidated → 0%
      makeThesis({ agentPersona: "sentiment", status: "INVALIDATED" }),
      makeThesis({ agentPersona: "sentiment", status: "INVALIDATED" }),
      makeThesis({ agentPersona: "sentiment", status: "INVALIDATED" }),
    ];

    const result = calculateAgentPerformance(theses);

    expect(result).toHaveLength(4);

    // Sorted by hitRate descending
    expect(result[0].persona).toBe("geopolitics");
    expect(result[0].hitRate).toBe(1);

    expect(result[1].persona).toBe("macro");
    expect(result[1].hitRate).toBe(0.75);

    expect(result[2].persona).toBe("tech");
    expect(result[2].hitRate).toBeCloseTo(0.3333, 3);

    expect(result[3].persona).toBe("sentiment");
    expect(result[3].hitRate).toBe(0);
  });

  it("separates stats by confidence level", () => {
    const theses: ThesisRow[] = [
      makeThesis({ confidence: "high", status: "CONFIRMED" }),
      makeThesis({ confidence: "high", status: "CONFIRMED" }),
      makeThesis({ confidence: "high", status: "INVALIDATED" }),
      makeThesis({ confidence: "low", status: "INVALIDATED" }),
      makeThesis({ confidence: "low", status: "INVALIDATED" }),
    ];

    const result = calculateAgentPerformance(theses);
    const macro = result[0];

    expect(macro.byConfidence["high"]).toEqual({
      total: 3,
      confirmed: 2,
      invalidated: 1,
      expired: 0,
      hitRate: 2 / 3,
    });
    expect(macro.byConfidence["low"]).toEqual({
      total: 2,
      confirmed: 0,
      invalidated: 2,
      expired: 0,
      hitRate: 0,
    });
  });

  it("includes EXPIRED in denominator for hitRate", () => {
    const theses: ThesisRow[] = [
      makeThesis({ status: "CONFIRMED" }),
      makeThesis({ status: "CONFIRMED" }),
      makeThesis({ status: "CONFIRMED" }),
      makeThesis({ status: "INVALIDATED" }),
      makeThesis({ status: "EXPIRED" }),
      makeThesis({ status: "EXPIRED" }),
    ];

    const result = calculateAgentPerformance(theses);

    // hitRate = 3 / (3 + 1 + 2) = 0.5
    expect(result[0].hitRate).toBeCloseTo(0.5, 3);
    expect(result[0].confirmed).toBe(3);
    expect(result[0].invalidated).toBe(1);
    expect(result[0].expired).toBe(2);
  });

  it("includes EXPIRED in byConfidence hitRate", () => {
    const theses: ThesisRow[] = [
      makeThesis({ confidence: "high", status: "CONFIRMED" }),
      makeThesis({ confidence: "high", status: "EXPIRED" }),
      makeThesis({ confidence: "high", status: "EXPIRED" }),
    ];

    const result = calculateAgentPerformance(theses);
    const highConf = result[0].byConfidence["high"];

    // hitRate = 1 / (1 + 0 + 2) = 0.3333
    expect(highConf.hitRate).toBeCloseTo(0.3333, 3);
  });

  it("returns hitRate 0 when only ACTIVE theses", () => {
    const theses: ThesisRow[] = [
      makeThesis({ status: "ACTIVE" }),
    ];

    const result = calculateAgentPerformance(theses);
    expect(result[0].hitRate).toBe(0);
  });

  it("counts EXPIRED-only as resolved with hitRate 0", () => {
    const theses: ThesisRow[] = [
      makeThesis({ status: "EXPIRED" }),
      makeThesis({ status: "EXPIRED" }),
    ];

    const result = calculateAgentPerformance(theses);
    // hitRate = 0 / (0 + 0 + 2) = 0
    expect(result[0].hitRate).toBe(0);
  });

  // #911: 동일 검증 조건 중복 보정 테스트
  it("#911: 동일 조건 8건 CONFIRMED → 1건으로 보정", () => {
    const theses: ThesisRow[] = [
      // 동일 조건 8건
      ...Array.from({ length: 8 }, (_, i) => makeThesis({
        agentPersona: "tech",
        status: "CONFIRMED",
        verificationMetric: "Technology RS",
        targetCondition: "> 50",
      })),
      // 1건 INVALIDATED (다른 조건)
      makeThesis({
        agentPersona: "tech",
        status: "INVALIDATED",
        verificationMetric: "VIX",
        targetCondition: "< 20",
      }),
    ];

    const result = calculateAgentPerformance(theses);
    expect(result[0].persona).toBe("tech");
    // 보정: 8건→1건 CONFIRMED + 1건 INVALIDATED → hitRate = 1/2 = 50%
    expect(result[0].confirmed).toBe(1);
    expect(result[0].invalidated).toBe(1);
    expect(result[0].hitRate).toBe(0.5);
  });

  it("#911: verificationMetric/targetCondition 없으면 기존 동작 유지", () => {
    const theses: ThesisRow[] = [
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "INVALIDATED" }),
    ];

    const result = calculateAgentPerformance(theses);
    // 기존 동작: 2 confirmed, 1 invalidated
    expect(result[0].confirmed).toBe(2);
    expect(result[0].invalidated).toBe(1);
    expect(result[0].hitRate).toBeCloseTo(0.6667, 3);
  });
});

describe("summarizePerformance", () => {
  it("returns message for empty stats", () => {
    expect(summarizePerformance([])).toBe("집계 대상 thesis 없음");
  });

  it("returns message when no resolved theses (only ACTIVE)", () => {
    const stats = calculateAgentPerformance([
      makeThesis({ status: "ACTIVE" }),
    ]);

    const summary = summarizePerformance(stats);
    expect(summary).toContain("검증 완료된 thesis 없음");
  });

  it("includes EXPIRED-only agents in ranking", () => {
    const stats = calculateAgentPerformance([
      makeThesis({ agentPersona: "tech", status: "EXPIRED" }),
    ]);

    const summary = summarizePerformance(stats);
    // EXPIRED counts as resolved, so tech should appear in the summary
    expect(summary).toContain("tech");
  });

  it("identifies best and worst performers", () => {
    const stats = calculateAgentPerformance([
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "macro", status: "INVALIDATED" }),
      makeThesis({ agentPersona: "sentiment", status: "CONFIRMED" }),
      makeThesis({ agentPersona: "sentiment", status: "INVALIDATED" }),
      makeThesis({ agentPersona: "sentiment", status: "INVALIDATED" }),
      makeThesis({ agentPersona: "sentiment", status: "INVALIDATED" }),
    ]);

    const summary = summarizePerformance(stats);
    expect(summary).toContain("macro");
    expect(summary).toContain("sentiment");
    expect(summary).toContain("최우수");
    expect(summary).toContain("최저");
  });

  it("handles single persona with resolved theses", () => {
    const stats = calculateAgentPerformance([
      makeThesis({ status: "CONFIRMED" }),
      makeThesis({ status: "INVALIDATED" }),
    ]);

    const summary = summarizePerformance(stats);
    expect(summary).toContain("macro");
  });
});
