import { describe, it, expect } from "vitest";
import {
  scoreFundamentals,
  calcEpsGrowthYoY,
  calcRevenueGrowthYoY,
  calcYoYGrowth,
  checkEpsAcceleration,
  checkMarginExpansion,
  estimateROE,
  determineGrade,
  calcRankScore,
  promoteTopToS,
} from "../../src/lib/fundamental-scorer.js";
import type {
  QuarterlyData,
  FundamentalInput,
  FundamentalGrade,
  FundamentalScore,
} from "../../src/types/fundamental.js";

// ─── helpers ────────────────────────────────────────────────────────

function q(
  asOfQ: string,
  periodEndDate: string,
  overrides: Partial<QuarterlyData> = {},
): QuarterlyData {
  return {
    periodEndDate,
    asOfQ,
    revenue: null,
    netIncome: null,
    epsDiluted: null,
    netMargin: null,
    ...overrides,
  };
}

/** 8분기 데이터 — newest first */
function makeInput(
  symbol: string,
  quarters: QuarterlyData[],
): FundamentalInput {
  return { symbol, quarters };
}

// ─── EPS YoY Growth ─────────────────────────────────────────────────

describe("calcEpsGrowthYoY", () => {
  it("calculates positive YoY growth", () => {
    const result = calcEpsGrowthYoY(1.5, 1.0);
    expect(result).toBe(50);
  });

  it("calculates negative YoY growth", () => {
    const result = calcEpsGrowthYoY(0.8, 1.0);
    expect(result).toBe(-20);
  });

  it("returns null when prior EPS is zero", () => {
    expect(calcEpsGrowthYoY(1.0, 0)).toBeNull();
  });

  it("returns null when prior EPS is null", () => {
    expect(calcEpsGrowthYoY(1.0, null)).toBeNull();
  });

  it("returns null when current EPS is null", () => {
    expect(calcEpsGrowthYoY(null, 1.0)).toBeNull();
  });

  it("handles turnaround from negative to positive", () => {
    // 음 → 양 전환은 의미 있는 % 산출 불가
    expect(calcEpsGrowthYoY(0.5, -0.3)).toBeNull();
  });
});

// ─── Revenue YoY Growth ─────────────────────────────────────────────

describe("calcRevenueGrowthYoY", () => {
  it("calculates positive revenue growth", () => {
    expect(calcRevenueGrowthYoY(1_000_000, 800_000)).toBe(25);
  });

  it("returns null when prior revenue is zero", () => {
    expect(calcRevenueGrowthYoY(500_000, 0)).toBeNull();
  });

  it("returns null when either value is null", () => {
    expect(calcRevenueGrowthYoY(null, 800_000)).toBeNull();
    expect(calcRevenueGrowthYoY(1_000_000, null)).toBeNull();
  });
});

// ─── EPS Acceleration ───────────────────────────────────────────────

describe("checkEpsAcceleration", () => {
  it("detects acceleration when growth rates increase", () => {
    // Q3: 20%, Q2: 30%, Q1(latest): 45% → accelerating
    const result = checkEpsAcceleration([45, 30, 20]);
    expect(result).toBe(true);
  });

  it("rejects when growth rates decelerate", () => {
    const result = checkEpsAcceleration([20, 30, 45]);
    expect(result).toBe(false);
  });

  it("rejects when growth rates are flat", () => {
    const result = checkEpsAcceleration([30, 30, 30]);
    expect(result).toBe(false);
  });

  it("returns false with fewer than 3 data points", () => {
    expect(checkEpsAcceleration([30, 20])).toBe(false);
    expect(checkEpsAcceleration([])).toBe(false);
  });
});

// ─── Margin Expansion ───────────────────────────────────────────────

describe("checkMarginExpansion", () => {
  it("detects expanding margins over 4 quarters", () => {
    // oldest → newest: 10% → 12% → 14% → 16%
    const result = checkMarginExpansion([16, 14, 12, 10]);
    expect(result).toBe(true);
  });

  it("rejects contracting margins", () => {
    const result = checkMarginExpansion([10, 12, 14, 16]);
    expect(result).toBe(false);
  });

  it("allows minor dip if overall trend is up", () => {
    // 10 → 12 → 11 → 14 (overall up, 1 dip allowed)
    const result = checkMarginExpansion([14, 11, 12, 10]);
    expect(result).toBe(true);
  });

  it("returns false with insufficient data", () => {
    expect(checkMarginExpansion([14, 12])).toBe(false);
    expect(checkMarginExpansion([])).toBe(false);
  });
});

// ─── ROE Estimation ─────────────────────────────────────────────────

describe("estimateROE", () => {
  it("returns null as ROE is not available (no equity data)", () => {
    expect(estimateROE([])).toBeNull();
  });

  it("returns null when data insufficient", () => {
    expect(estimateROE([])).toBeNull();
  });
});

// ─── Full Scorer ────────────────────────────────────────────────────

describe("scoreFundamentals", () => {
  it("grades A when both required + 2 bonus met", () => {
    // NVDA-like: explosive EPS growth, revenue growth, acceleration, margin expansion
    const input = makeInput("NVDA", [
      // Latest 4 quarters (newest first)
      q("Q4 2025", "2025-12-31", { epsDiluted: 1.89, revenue: 35_100_000_000, netIncome: 20_000_000_000, netMargin: 57 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 1.27, revenue: 30_000_000_000, netIncome: 16_000_000_000, netMargin: 53 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 0.98, revenue: 26_000_000_000, netIncome: 13_000_000_000, netMargin: 50 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: 0.82, revenue: 22_000_000_000, netIncome: 10_000_000_000, netMargin: 45 }),
      // Prior year same quarters
      q("Q4 2024", "2024-12-31", { epsDiluted: 0.78, revenue: 18_000_000_000, netIncome: 7_000_000_000, netMargin: 39 }),
      q("Q3 2024", "2024-09-30", { epsDiluted: 0.55, revenue: 15_000_000_000, netIncome: 5_000_000_000, netMargin: 33 }),
      q("Q2 2024", "2024-06-30", { epsDiluted: 0.45, revenue: 12_000_000_000, netIncome: 3_500_000_000, netMargin: 29 }),
      q("Q1 2024", "2024-03-31", { epsDiluted: 0.35, revenue: 10_000_000_000, netIncome: 2_500_000_000, netMargin: 25 }),
    ]);

    const score = scoreFundamentals(input);

    expect(score.grade).toBe("A");
    expect(score.requiredMet).toBe(2);
    expect(score.bonusMet).toBeGreaterThanOrEqual(2);
    expect(score.criteria.epsGrowth.passed).toBe(true);
    expect(score.criteria.revenueGrowth.passed).toBe(true);
    expect(score.criteria.epsAcceleration.passed).toBe(true);
    expect(score.criteria.marginExpansion.passed).toBe(true);
  });

  it("grades B when 1 required + 2 bonus met", () => {
    const input = makeInput("GOOD", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 1.50, revenue: 5_000_000_000, netIncome: 500_000_000, netMargin: 10 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 1.30, revenue: 4_800_000_000, netIncome: 450_000_000, netMargin: 9.4 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 1.10, revenue: 4_600_000_000, netIncome: 400_000_000, netMargin: 8.7 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: 0.95, revenue: 4_400_000_000, netIncome: 350_000_000, netMargin: 8.0 }),
      // Prior year — EPS grew >25% but revenue only ~15%
      q("Q4 2024", "2024-12-31", { epsDiluted: 1.10, revenue: 4_350_000_000, netIncome: 400_000_000, netMargin: 9.2 }),
      q("Q3 2024", "2024-09-30", { epsDiluted: 0.95, revenue: 4_200_000_000, netIncome: 370_000_000, netMargin: 8.8 }),
      q("Q2 2024", "2024-06-30", { epsDiluted: 0.80, revenue: 4_000_000_000, netIncome: 320_000_000, netMargin: 8.0 }),
      q("Q1 2024", "2024-03-31", { epsDiluted: 0.70, revenue: 3_800_000_000, netIncome: 280_000_000, netMargin: 7.4 }),
    ]);

    const score = scoreFundamentals(input);

    expect(score.grade).toBe("B");
    expect(score.requiredMet).toBeGreaterThanOrEqual(1);
  });

  it("grades C when no required met but some bonus", () => {
    const input = makeInput("MEH", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 0.55, revenue: 2_000_000_000, netIncome: 100_000_000, netMargin: 5.0 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 0.52, revenue: 1_950_000_000, netIncome: 95_000_000, netMargin: 4.9 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 0.50, revenue: 1_900_000_000, netIncome: 90_000_000, netMargin: 4.7 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: 0.48, revenue: 1_850_000_000, netIncome: 85_000_000, netMargin: 4.6 }),
      // Prior year — minimal growth (<25%)
      q("Q4 2024", "2024-12-31", { epsDiluted: 0.50, revenue: 1_800_000_000, netIncome: 90_000_000, netMargin: 5.0 }),
      q("Q3 2024", "2024-09-30", { epsDiluted: 0.48, revenue: 1_750_000_000, netIncome: 85_000_000, netMargin: 4.9 }),
      q("Q2 2024", "2024-06-30", { epsDiluted: 0.46, revenue: 1_700_000_000, netIncome: 80_000_000, netMargin: 4.7 }),
      q("Q1 2024", "2024-03-31", { epsDiluted: 0.44, revenue: 1_650_000_000, netIncome: 75_000_000, netMargin: 4.5 }),
    ]);

    const score = scoreFundamentals(input);

    expect(score.grade).toBe("C");
    expect(score.requiredMet).toBe(0);
  });

  it("grades F when data insufficient (< 5 quarters)", () => {
    const input = makeInput("NEW", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 1.0, revenue: 1_000_000_000, netIncome: 100_000_000, netMargin: 10 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 0.9, revenue: 900_000_000, netIncome: 90_000_000, netMargin: 10 }),
    ]);

    const score = scoreFundamentals(input);

    expect(score.grade).toBe("F");
    expect(score.criteria.epsGrowth.detail).toContain("데이터 부족");
  });

  it("grades F when all data is null", () => {
    const input = makeInput("EMPTY", [
      q("Q4 2025", "2025-12-31"),
      q("Q3 2025", "2025-09-30"),
      q("Q2 2025", "2025-06-30"),
      q("Q1 2025", "2025-03-31"),
      q("Q4 2024", "2024-12-31"),
      q("Q3 2024", "2024-09-30"),
      q("Q2 2024", "2024-06-30"),
      q("Q1 2024", "2024-03-31"),
    ]);

    const score = scoreFundamentals(input);

    expect(score.grade).toBe("F");
  });

  it("handles negative EPS turning positive (turnaround)", () => {
    const input = makeInput("TURN", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 0.50, revenue: 3_000_000_000, netIncome: 200_000_000, netMargin: 6.7 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 0.30, revenue: 2_800_000_000, netIncome: 120_000_000, netMargin: 4.3 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 0.10, revenue: 2_600_000_000, netIncome: 40_000_000, netMargin: 1.5 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: -0.05, revenue: 2_500_000_000, netIncome: -20_000_000, netMargin: -0.8 }),
      q("Q4 2024", "2024-12-31", { epsDiluted: -0.20, revenue: 2_300_000_000, netIncome: -80_000_000, netMargin: -3.3 }),
      q("Q3 2024", "2024-09-30", { epsDiluted: -0.30, revenue: 2_300_000_000, netIncome: -120_000_000, netMargin: -5.2 }),
      q("Q2 2024", "2024-06-30", { epsDiluted: -0.35, revenue: 2_200_000_000, netIncome: -140_000_000, netMargin: -6.4 }),
      q("Q1 2024", "2024-03-31", { epsDiluted: -0.40, revenue: 2_100_000_000, netIncome: -160_000_000, netMargin: -7.6 }),
    ]);

    const score = scoreFundamentals(input);

    // 음→양 전환이므로 EPS 성장률 계산 불가 → required 미충족
    expect(score.criteria.epsGrowth.passed).toBe(false);
    // 매출은 25% 성장 충족
    expect(score.criteria.revenueGrowth.passed).toBe(true);
    // 마진 확대는 맞음
    expect(score.criteria.marginExpansion.passed).toBe(true);
  });

  it("returns correct symbol in result", () => {
    const input = makeInput("AAPL", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 2.0, revenue: 100_000_000_000 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 1.8, revenue: 90_000_000_000 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 1.6, revenue: 85_000_000_000 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: 1.5, revenue: 80_000_000_000 }),
      q("Q4 2024", "2024-12-31", { epsDiluted: 1.5, revenue: 78_000_000_000 }),
    ]);

    const score = scoreFundamentals(input);
    expect(score.symbol).toBe("AAPL");
  });

  it("only counts valid bonus criteria", () => {
    // EPS growth met, revenue growth met, but no margin data, no acceleration
    const input = makeInput("LEAN", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 2.0, revenue: 5_000_000_000 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 1.7, revenue: 4_500_000_000 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 1.5, revenue: 4_200_000_000 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: 1.3, revenue: 3_900_000_000 }),
      q("Q4 2024", "2024-12-31", { epsDiluted: 1.5, revenue: 3_800_000_000 }),
      q("Q3 2024", "2024-09-30", { epsDiluted: 1.3, revenue: 3_500_000_000 }),
      q("Q2 2024", "2024-06-30", { epsDiluted: 1.1, revenue: 3_200_000_000 }),
      q("Q1 2024", "2024-03-31", { epsDiluted: 1.0, revenue: 3_000_000_000 }),
    ]);

    const score = scoreFundamentals(input);

    expect(score.requiredMet).toBe(2);
    // bonus: no margin data → marginExpansion false, roe null → false
    // epsAcceleration depends on growth rates
  });
});

// ─── determineGrade boundary cases ──────────────────────────────────

describe("determineGrade", () => {
  it("A: required=2, bonus=2", () => {
    expect(determineGrade(2, 2)).toBe("A");
  });

  it("B: required=2, bonus=1", () => {
    expect(determineGrade(2, 1)).toBe("B");
  });

  it("B: required=2, bonus=0 (필수 전부 충족 → 최소 B)", () => {
    expect(determineGrade(2, 0)).toBe("B");
  });

  it("B: required=1, bonus=1", () => {
    expect(determineGrade(1, 1)).toBe("B");
  });

  it("C: required=1, bonus=0", () => {
    expect(determineGrade(1, 0)).toBe("C");
  });

  it("C: required=0, bonus=1", () => {
    expect(determineGrade(0, 1)).toBe("C");
  });

  it("C: required=0, bonus=2", () => {
    expect(determineGrade(0, 2)).toBe("C");
  });

  it("F: required=0, bonus=0", () => {
    expect(determineGrade(0, 0)).toBe("F");
  });
});

// ─── calcYoYGrowth (unified) ────────────────────────────────────────

describe("calcYoYGrowth", () => {
  it("is the same function as calcEpsGrowthYoY and calcRevenueGrowthYoY", () => {
    expect(calcYoYGrowth).toBe(calcEpsGrowthYoY);
    expect(calcYoYGrowth).toBe(calcRevenueGrowthYoY);
  });
});

// ─── EPS growth exactly at threshold ────────────────────────────────

describe("scoreFundamentals — threshold boundary", () => {
  it("fails with exactly 25% EPS growth (strict >)", () => {
    const input = makeInput("EDGE", [
      q("Q4 2025", "2025-12-31", { epsDiluted: 1.25, revenue: 5_000_000_000 }),
      q("Q3 2025", "2025-09-30", { epsDiluted: 1.10, revenue: 4_500_000_000 }),
      q("Q2 2025", "2025-06-30", { epsDiluted: 1.00, revenue: 4_000_000_000 }),
      q("Q1 2025", "2025-03-31", { epsDiluted: 0.90, revenue: 3_500_000_000 }),
      q("Q4 2024", "2024-12-31", { epsDiluted: 1.00, revenue: 3_000_000_000 }),
    ]);

    const score = scoreFundamentals(input);

    // 1.25 / 1.00 = 25% exactly → should NOT pass (> 25% required)
    expect(score.criteria.epsGrowth.passed).toBe(false);
  });
});

// ─── rankScore ──────────────────────────────────────────────────────

describe("calcRankScore", () => {
  it("higher EPS growth → higher rank score", () => {
    const low = calcRankScore({
      epsGrowth: { passed: true, value: 30, detail: "" },
      revenueGrowth: { passed: true, value: 30, detail: "" },
      epsAcceleration: { passed: false, value: null, detail: "" },
      marginExpansion: { passed: false, value: null, detail: "" },
      roe: { passed: false, value: null, detail: "" },
    });
    const high = calcRankScore({
      epsGrowth: { passed: true, value: 150, detail: "" },
      revenueGrowth: { passed: true, value: 100, detail: "" },
      epsAcceleration: { passed: true, value: null, detail: "" },
      marginExpansion: { passed: false, value: null, detail: "" },
      roe: { passed: false, value: null, detail: "" },
    });
    expect(high).toBeGreaterThan(low);
  });

  it("acceleration adds bonus", () => {
    const without = calcRankScore({
      epsGrowth: { passed: true, value: 50, detail: "" },
      revenueGrowth: { passed: true, value: 50, detail: "" },
      epsAcceleration: { passed: false, value: null, detail: "" },
      marginExpansion: { passed: false, value: null, detail: "" },
      roe: { passed: false, value: null, detail: "" },
    });
    const withAccel = calcRankScore({
      epsGrowth: { passed: true, value: 50, detail: "" },
      revenueGrowth: { passed: true, value: 50, detail: "" },
      epsAcceleration: { passed: true, value: null, detail: "" },
      marginExpansion: { passed: false, value: null, detail: "" },
      roe: { passed: false, value: null, detail: "" },
    });
    expect(withAccel).toBe(without + 50);
  });
});

// ─── promoteTopToS ──────────────────────────────────────────────────

describe("promoteTopToS", () => {
  function fakeScore(symbol: string, grade: "A" | "B" | "C" | "F", rankScore: number): FundamentalScore {
    return {
      symbol, grade, totalScore: 0, rankScore, requiredMet: 0, bonusMet: 0,
      criteria: {
        epsGrowth: { passed: false, value: null, detail: "" },
        revenueGrowth: { passed: false, value: null, detail: "" },
        epsAcceleration: { passed: false, value: null, detail: "" },
        marginExpansion: { passed: false, value: null, detail: "" },
        roe: { passed: false, value: null, detail: "" },
      },
    };
  }

  it("promotes top 3 A-grade to S", () => {
    const scores = [
      fakeScore("NVDA", "A", 500),
      fakeScore("PLTR", "A", 400),
      fakeScore("MU", "A", 350),
      fakeScore("AAPL", "A", 200),
      fakeScore("MSFT", "B", 180),
    ];

    const result = promoteTopToS(scores);

    expect(result.find((s) => s.symbol === "NVDA")!.grade).toBe("S");
    expect(result.find((s) => s.symbol === "PLTR")!.grade).toBe("S");
    expect(result.find((s) => s.symbol === "MU")!.grade).toBe("S");
    expect(result.find((s) => s.symbol === "AAPL")!.grade).toBe("A");
    expect(result.find((s) => s.symbol === "MSFT")!.grade).toBe("B");
  });

  it("promotes all if fewer than 3 A-grade", () => {
    const scores = [
      fakeScore("NVDA", "A", 500),
      fakeScore("MSFT", "B", 300),
    ];

    const result = promoteTopToS(scores);

    expect(result.find((s) => s.symbol === "NVDA")!.grade).toBe("S");
    expect(result.find((s) => s.symbol === "MSFT")!.grade).toBe("B");
  });

  it("does nothing when no A-grade", () => {
    const scores = [
      fakeScore("MSFT", "B", 300),
      fakeScore("BAD", "F", 0),
    ];

    const result = promoteTopToS(scores);

    expect(result).toEqual(scores);
  });
});
