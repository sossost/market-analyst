import { describe, it, expect } from "vitest";
import { formatFundamentalSupplement } from "../../../src/agent/fundamental/runFundamentalValidation.js";
import type { FundamentalScore, CriteriaResult } from "../../../src/types/fundamental.js";

const emptyCriteria: CriteriaResult = { passed: false, value: null, detail: "" };

function makeScore(symbol: string, grade: "A" | "B" | "C" | "F", epsValue: number | null = null): FundamentalScore {
  return {
    symbol,
    grade,
    totalScore: 0,
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

  it("shows C grade with warning", () => {
    const result = formatFundamentalSupplement([makeScore("MEH", "C")]);
    expect(result).toContain("🟡 **MEH** [C] — 기술적으로만 Phase 2");
  });

  it("shows F grade with red emoji", () => {
    const result = formatFundamentalSupplement([makeScore("BAD", "F")]);
    expect(result).toContain("🔴 **BAD** [F] — 펀더멘탈 미달");
  });

  it("sorts by grade A > B > C > F", () => {
    const result = formatFundamentalSupplement([
      makeScore("BAD", "F"),
      makeScore("NVDA", "A", 142),
      makeScore("MEH", "C"),
      makeScore("GOOD", "B", 30),
    ]);

    const lines = result.split("\n").filter((l) => l.startsWith("🟢") || l.startsWith("🔵") || l.startsWith("🟡") || l.startsWith("🔴"));
    expect(lines[0]).toContain("NVDA");
    expect(lines[1]).toContain("GOOD");
    expect(lines[2]).toContain("MEH");
    expect(lines[3]).toContain("BAD");
  });

  it("includes header", () => {
    const result = formatFundamentalSupplement([makeScore("NVDA", "A", 100)]);
    expect(result).toContain("## 펀더멘탈 검증 결과");
  });
});
