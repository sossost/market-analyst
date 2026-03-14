import { describe, it, expect } from "vitest";
import { selectFallbackCandidates } from "../runFundamentalValidation.js";
import type { FundamentalScore } from "../../../types/fundamental.js";

function mockScore(
  overrides: Partial<FundamentalScore> & { symbol: string },
): FundamentalScore {
  return {
    grade: "A",
    totalScore: 80,
    rankScore: 50,
    requiredMet: 2,
    bonusMet: 1,
    criteria: {
      epsGrowth: { passed: true, value: 30, detail: "EPS YoY +30%" },
      revenueGrowth: { passed: true, value: 25, detail: "매출 YoY +25%" },
      epsAcceleration: { passed: false, value: null, detail: "가속 없음" },
      marginExpansion: { passed: true, value: 2.5, detail: "마진 확대 +2.5%p" },
      roe: { passed: false, value: null, detail: "ROE N/A" },
    },
    ...overrides,
  };
}

describe("selectFallbackCandidates", () => {
  it("neededCount가 0이면 빈 배열을 반환한다", () => {
    const allScores = [
      mockScore({ symbol: "AAPL", grade: "A", rankScore: 90 }),
      mockScore({ symbol: "MSFT", grade: "A", rankScore: 80 }),
      mockScore({ symbol: "GOOG", grade: "A", rankScore: 70 }),
    ];
    const currentSSymbols = new Set(["NVDA", "TSLA", "AMD"]);

    const result = selectFallbackCandidates(allScores, currentSSymbols, 0);

    expect(result).toEqual([]);
  });

  it("A급 중 rankScore 내림차순으로 neededCount개를 반환한다", () => {
    const allScores = [
      mockScore({ symbol: "AAPL", grade: "A", rankScore: 90 }),
      mockScore({ symbol: "MSFT", grade: "A", rankScore: 70 }),
      mockScore({ symbol: "GOOG", grade: "A", rankScore: 80 }),
      mockScore({ symbol: "NVDA", grade: "S", rankScore: 100 }),
    ];
    const currentSSymbols = new Set(["NVDA"]);

    const result = selectFallbackCandidates(allScores, currentSSymbols, 1);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("AAPL");
    expect(result[0].rankScore).toBe(90);
  });

  it("A급이 0개면 빈 배열을 반환한다", () => {
    const allScores = [
      mockScore({ symbol: "NVDA", grade: "S", rankScore: 100 }),
      mockScore({ symbol: "TSLA", grade: "B", rankScore: 40 }),
    ];
    const currentSSymbols = new Set(["NVDA"]);

    const result = selectFallbackCandidates(allScores, currentSSymbols, 2);

    expect(result).toEqual([]);
  });

  it("neededCount가 A급 수보다 크면 있는 만큼만 반환한다", () => {
    const allScores = [
      mockScore({ symbol: "AAPL", grade: "A", rankScore: 90 }),
      mockScore({ symbol: "MSFT", grade: "A", rankScore: 80 }),
    ];
    const currentSSymbols = new Set<string>();

    const result = selectFallbackCandidates(allScores, currentSSymbols, 5);

    expect(result).toHaveLength(2);
  });

  it("currentSSymbols에 포함된 A급 종목은 제외한다", () => {
    const allScores = [
      mockScore({ symbol: "AAPL", grade: "A", rankScore: 90 }),
      mockScore({ symbol: "MSFT", grade: "A", rankScore: 80 }),
      mockScore({ symbol: "GOOG", grade: "A", rankScore: 70 }),
    ];
    // AAPL과 MSFT가 이미 S급으로 올라가 있는 상황
    const currentSSymbols = new Set(["AAPL", "MSFT"]);

    const result = selectFallbackCandidates(allScores, currentSSymbols, 2);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("GOOG");
  });
});
