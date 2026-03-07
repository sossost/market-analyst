import { describe, it, expect } from "vitest";
import { formatFundamentalSupplement } from "../../../src/agent/fundamental/runFundamentalValidation.js";
import type { FundamentalScore, CriteriaResult } from "../../../src/types/fundamental.js";

const emptyCriteria: CriteriaResult = { passed: false, value: null, detail: "" };

function makeScore(symbol: string, grade: "A" | "B" | "C" | "F", epsValue: number | null = null): FundamentalScore {
  return {
    symbol,
    grade,
    totalScore: 0,
    rankScore: 0,
    requiredMet: 0,
    bonusMet: 0,
    criteria: {
      epsGrowth: { passed: epsValue != null, value: epsValue, detail: epsValue != null ? `EPS YoY +${epsValue}%` : "" },
      revenueGrowth: emptyCriteria,
      epsAcceleration: emptyCriteria,
      marginExpansion: emptyCriteria,
      roe: emptyCriteria,
    },
  };
}

describe("formatFundamentalSupplement", () => {
  it("returns empty string for no scores", () => {
    expect(formatFundamentalSupplement([])).toBe("");
  });

  it("shows A grade with green emoji and EPS detail", () => {
    const result = formatFundamentalSupplement([makeScore("NVDA", "A", 142)]);
    expect(result).toContain("🟢 **NVDA** [A] — EPS YoY +142%");
  });

  it("shows B grade with blue emoji", () => {
    const result = formatFundamentalSupplement([makeScore("AAPL", "B", 30)]);
    expect(result).toContain("🔵 **AAPL** [B]");
  });

  it("summarizes C/F grades as counts instead of individual lines", () => {
    const result = formatFundamentalSupplement([makeScore("MEH", "C")]);
    expect(result).toContain("C등급 1개");
    expect(result).not.toContain("**MEH**");
  });

  it("summarizes F grades as counts", () => {
    const result = formatFundamentalSupplement([makeScore("BAD", "F")]);
    expect(result).toContain("F등급 1개");
    expect(result).not.toContain("**BAD**");
  });

  it("sorts S/A/B individually then C/F as summary", () => {
    const result = formatFundamentalSupplement([
      makeScore("BAD", "F"),
      makeScore("NVDA", "A", 142),
      makeScore("MEH", "C"),
      makeScore("GOOD", "B", 30),
    ]);

    const lines = result.split("\n").filter((l) => l.trim() !== "");
    const detailLines = lines.filter((l) => l.startsWith("🟢") || l.startsWith("🔵"));
    expect(detailLines[0]).toContain("NVDA");
    expect(detailLines[1]).toContain("GOOD");
    expect(result).toContain("C등급 1개");
    expect(result).toContain("F등급 1개");
    expect(result).not.toContain("**MEH**");
    expect(result).not.toContain("**BAD**");
  });

  it("includes header by default", () => {
    const result = formatFundamentalSupplement([makeScore("NVDA", "A", 100)]);
    expect(result).toContain("## 펀더멘탈 검증 결과");
  });

  it("excludes header when includeHeader is false", () => {
    const result = formatFundamentalSupplement([makeScore("NVDA", "A", 100)], { includeHeader: false });
    expect(result).not.toContain("## 펀더멘탈 검증 결과");
    expect(result).toContain("NVDA");
  });

  it("shows S grade with star emoji", () => {
    const result = formatFundamentalSupplement([makeScore("NVDA", "S" as any, 142)]);
    expect(result).toContain("⭐ **NVDA** [S] — EPS YoY +142%");
  });

  it("sorts S before A", () => {
    const result = formatFundamentalSupplement([
      makeScore("AAPL", "A", 50),
      makeScore("NVDA", "S" as any, 142),
    ]);

    const lines = result.split("\n").filter((l) => l.startsWith("⭐") || l.startsWith("🟢"));
    expect(lines[0]).toContain("NVDA");
    expect(lines[1]).toContain("AAPL");
  });
});
