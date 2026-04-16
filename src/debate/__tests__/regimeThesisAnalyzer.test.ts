import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB 모킹 ─────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...a: unknown[]) => {
          mockFrom(...a);
          return {
            innerJoin: (...b: unknown[]) => {
              mockInnerJoin(...b);
              return {
                where: (...c: unknown[]) => {
                  mockWhere(...c);
                  return {
                    groupBy: (...d: unknown[]) => {
                      mockGroupBy(...d);
                      return mockGroupBy.mock.results.at(-1)?.value ?? [];
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (str: unknown) => str,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
}));

vi.mock("@/db/schema/analyst", () => ({
  theses: {
    debateDate: "debate_date",
    status: "status",
    category: "category",
    agentPersona: "agent_persona",
  },
  marketRegimes: {
    regimeDate: "regime_date",
    regime: "regime",
    isConfirmed: "is_confirmed",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── 모킹 후 대상 모듈 import ─────────────────────────────────────────────────

import {
  calcRegimeHitRates,
  calcRegimeBiases,
  getRegimePerformanceSummary,
  formatRegimePerformanceForPrompt,
  type RegimeHitRate,
  type RegimePerformanceSummary,
} from "../regimeThesisAnalyzer.js";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── calcRegimeHitRates ──────────────────────────────────────────────────────

describe("calcRegimeHitRates", () => {
  it("returns hit rates grouped by regime", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { regime: "MID_BULL", total: 10, confirmed: 7, invalidated: 3 },
      { regime: "EARLY_BEAR", total: 5, confirmed: 2, invalidated: 3 },
    ]);

    const result = await calcRegimeHitRates();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      regime: "MID_BULL",
      total: 10,
      confirmed: 7,
      invalidated: 3,
      hitRate: 0.7,
    });
    expect(result[1]).toEqual({
      regime: "EARLY_BEAR",
      total: 5,
      confirmed: 2,
      invalidated: 3,
      hitRate: 0.4,
    });
  });

  it("returns empty array when no resolved theses exist", async () => {
    mockGroupBy.mockResolvedValueOnce([]);

    const result = await calcRegimeHitRates();

    expect(result).toHaveLength(0);
  });

  it("handles zero total gracefully (hitRate = 0)", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { regime: "BEAR", total: 0, confirmed: 0, invalidated: 0 },
    ]);

    const result = await calcRegimeHitRates();

    expect(result[0].hitRate).toBe(0);
  });
});

// ─── calcRegimeBiases ────────────────────────────────────────────────────────

describe("calcRegimeBiases", () => {
  it("aggregates category and persona breakdowns by regime", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { regime: "MID_BULL", category: "structural_narrative", persona: "macro", count: 3 },
      { regime: "MID_BULL", category: "sector_rotation", persona: "tech", count: 2 },
      { regime: "EARLY_BEAR", category: "sector_rotation", persona: "sentiment", count: 4 },
    ]);

    const result = await calcRegimeBiases();

    expect(result).toHaveLength(2);

    const midBull = result.find((r) => r.regime === "MID_BULL")!;
    expect(midBull.total).toBe(5);
    expect(midBull.categoryBreakdown).toEqual({
      structural_narrative: 3,
      sector_rotation: 2,
    });
    expect(midBull.personaBreakdown).toEqual({
      macro: 3,
      tech: 2,
    });
  });

  it("returns empty array when no data", async () => {
    mockGroupBy.mockResolvedValueOnce([]);
    const result = await calcRegimeBiases();
    expect(result).toHaveLength(0);
  });
});

// ─── getRegimePerformanceSummary ─────────────────────────────────────────────

describe("getRegimePerformanceSummary", () => {
  it("computes overall hit rate and sufficient data flag", async () => {
    // First call for hit rates
    mockGroupBy.mockResolvedValueOnce([
      { regime: "MID_BULL", total: 10, confirmed: 7, invalidated: 3 },
      { regime: "EARLY_BEAR", total: 6, confirmed: 3, invalidated: 3 },
    ]);
    // Second call for biases
    mockGroupBy.mockResolvedValueOnce([
      { regime: "MID_BULL", category: "structural_narrative", persona: "macro", count: 10 },
      { regime: "EARLY_BEAR", category: "sector_rotation", persona: "tech", count: 6 },
    ]);

    const result = await getRegimePerformanceSummary();

    expect(result.totalResolved).toBe(16);
    expect(result.overallHitRate).toBe(0.63);
    expect(result.hasSufficientData).toBe(true);
    expect(result.regimeHitRates).toHaveLength(2);
    expect(result.regimeBiases).toHaveLength(2);
  });

  it("marks insufficient data when regime has < 5 samples", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { regime: "MID_BULL", total: 3, confirmed: 2, invalidated: 1 },
    ]);
    mockGroupBy.mockResolvedValueOnce([]);

    const result = await getRegimePerformanceSummary();

    expect(result.hasSufficientData).toBe(false);
  });
});

// ─── formatRegimePerformanceForPrompt ────────────────────────────────────────

describe("formatRegimePerformanceForPrompt", () => {
  const baseSummary: RegimePerformanceSummary = {
    regimeHitRates: [
      { regime: "MID_BULL", total: 10, confirmed: 7, invalidated: 3, hitRate: 0.7 },
      { regime: "EARLY_BEAR", total: 8, confirmed: 3, invalidated: 5, hitRate: 0.38 },
    ],
    regimeBiases: [
      {
        regime: "MID_BULL",
        total: 10,
        categoryBreakdown: { structural_narrative: 6, sector_rotation: 4 },
        personaBreakdown: { macro: 5, tech: 5 },
      },
    ],
    totalResolved: 18,
    overallHitRate: 0.56,
    hasSufficientData: true,
  };

  it("returns empty string when no hit rates", () => {
    const empty: RegimePerformanceSummary = {
      regimeHitRates: [],
      regimeBiases: [],
      totalResolved: 0,
      overallHitRate: 0,
      hasSufficientData: false,
    };
    expect(formatRegimePerformanceForPrompt(empty)).toBe("");
  });

  it("includes header and hit rate table", () => {
    const result = formatRegimePerformanceForPrompt(baseSummary);
    expect(result).toContain("## 레짐별 Thesis 적중률");
    expect(result).toContain("MID_BULL");
    expect(result).toContain("70%");
    expect(result).toContain("EARLY_BEAR");
    expect(result).toContain("38%");
    expect(result).toContain("전체 적중률");
  });

  it("highlights current regime with marker", () => {
    const result = formatRegimePerformanceForPrompt(baseSummary, "MID_BULL");
    expect(result).toContain("MID_BULL ◀ 현재");
    expect(result).toContain("현재 레짐(MID_BULL)에서의 과거 적중률: 70%");
  });

  it("warns when current regime hit rate is low", () => {
    const result = formatRegimePerformanceForPrompt(baseSummary, "EARLY_BEAR");
    expect(result).toContain("적중률이 낮습니다");
    expect(result).toContain("보수적 접근을 권장");
  });

  it("shows insufficient data warning", () => {
    const insufficientSummary: RegimePerformanceSummary = {
      ...baseSummary,
      hasSufficientData: false,
    };
    const result = formatRegimePerformanceForPrompt(insufficientSummary);
    expect(result).toContain("샘플이 부족");
  });

  it("includes category breakdown in bias section", () => {
    const result = formatRegimePerformanceForPrompt(baseSummary);
    expect(result).toContain("레짐별 카테고리 분포");
    expect(result).toContain("structural_narrative");
  });
});
