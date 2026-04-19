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
                  const whereResult = mockWhere(...c);
                  // #911: calcRegimeHitRates는 .where()에서 종료 (groupBy 없음)
                  // mockWhere가 값을 반환하면 그대로 사용, 아니면 groupBy 체인 제공
                  if (whereResult != null && typeof whereResult.then === "function") {
                    // Promise를 반환한 경우 — thenable이면 groupBy도 달아줌
                    const thenableWithGroupBy = whereResult;
                    thenableWithGroupBy.groupBy = (...d: unknown[]) => {
                      mockGroupBy(...d);
                      return mockGroupBy.mock.results.at(-1)?.value ?? [];
                    };
                    return thenableWithGroupBy;
                  }
                  return {
                    groupBy: (...d: unknown[]) => {
                      mockGroupBy(...d);
                      return mockGroupBy.mock.results.at(-1)?.value ?? [];
                    },
                    then: undefined,
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
  it("returns hit rates grouped by regime (#911: raw rows + dedup)", async () => {
    // #911: calcRegimeHitRates는 이제 raw rows를 반환하고 JS에서 그룹화/dedup
    // 쿼리 체인이 .where()에서 종료 (groupBy 없음)
    mockWhere.mockResolvedValueOnce([
      // MID_BULL: 7 confirmed, 3 invalidated (각각 고유 조건)
      ...Array.from({ length: 7 }, (_, i) => ({
        regime: "MID_BULL", status: "CONFIRMED",
        verificationMetric: `Metric ${i}`, targetCondition: `> ${i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        regime: "MID_BULL", status: "INVALIDATED",
        verificationMetric: `Metric ${100 + i}`, targetCondition: `> ${100 + i}`,
      })),
      // EARLY_BEAR: 2 confirmed, 3 invalidated
      ...Array.from({ length: 2 }, (_, i) => ({
        regime: "EARLY_BEAR", status: "CONFIRMED",
        verificationMetric: `Metric ${200 + i}`, targetCondition: `> ${200 + i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        regime: "EARLY_BEAR", status: "INVALIDATED",
        verificationMetric: `Metric ${300 + i}`, targetCondition: `> ${300 + i}`,
      })),
    ]);

    const result = await calcRegimeHitRates();

    expect(result).toHaveLength(2);
    const midBull = result.find((r) => r.regime === "MID_BULL")!;
    expect(midBull.confirmed).toBe(7);
    expect(midBull.invalidated).toBe(3);
    expect(midBull.total).toBe(10);
    expect(midBull.hitRate).toBe(0.7);

    const earlyBear = result.find((r) => r.regime === "EARLY_BEAR")!;
    expect(earlyBear.confirmed).toBe(2);
    expect(earlyBear.invalidated).toBe(3);
    expect(earlyBear.total).toBe(5);
    expect(earlyBear.hitRate).toBe(0.4);
  });

  it("returns empty array when no resolved theses exist", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const result = await calcRegimeHitRates();

    expect(result).toHaveLength(0);
  });

  it("handles dedup — same condition counts as 1 (#911)", async () => {
    mockWhere.mockResolvedValueOnce([
      // 3건 동일 조건 CONFIRMED → 1건으로 보정
      { regime: "MID_BULL", status: "CONFIRMED", verificationMetric: "Technology RS", targetCondition: "> 50" },
      { regime: "MID_BULL", status: "CONFIRMED", verificationMetric: "Technology RS", targetCondition: "> 50" },
      { regime: "MID_BULL", status: "CONFIRMED", verificationMetric: "Technology RS", targetCondition: "> 50" },
      // 1건 다른 조건 INVALIDATED
      { regime: "MID_BULL", status: "INVALIDATED", verificationMetric: "VIX", targetCondition: "< 20" },
    ]);

    const result = await calcRegimeHitRates();
    expect(result[0].confirmed).toBe(1);
    expect(result[0].invalidated).toBe(1);
    expect(result[0].total).toBe(2);
    expect(result[0].hitRate).toBe(0.5);
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
    // #911: calcRegimeHitRates는 .where()에서 raw rows 반환
    mockWhere.mockResolvedValueOnce([
      ...Array.from({ length: 7 }, (_, i) => ({
        regime: "MID_BULL", status: "CONFIRMED",
        verificationMetric: `M${i}`, targetCondition: `>${i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        regime: "MID_BULL", status: "INVALIDATED",
        verificationMetric: `M${100 + i}`, targetCondition: `>${100 + i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        regime: "EARLY_BEAR", status: "CONFIRMED",
        verificationMetric: `M${200 + i}`, targetCondition: `>${200 + i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        regime: "EARLY_BEAR", status: "INVALIDATED",
        verificationMetric: `M${300 + i}`, targetCondition: `>${300 + i}`,
      })),
    ]);
    // Second call for biases (still uses groupBy)
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
    mockWhere.mockResolvedValueOnce([
      ...Array.from({ length: 2 }, (_, i) => ({
        regime: "MID_BULL", status: "CONFIRMED",
        verificationMetric: `M${i}`, targetCondition: `>${i}`,
      })),
      { regime: "MID_BULL", status: "INVALIDATED", verificationMetric: "M99", targetCondition: ">99" },
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
