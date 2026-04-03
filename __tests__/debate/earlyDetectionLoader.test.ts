import { describe, it, expect } from "vitest";
import { formatEarlyDetectionContext, type EarlyDetectionData } from "@/debate/earlyDetectionLoader";

describe("formatEarlyDetectionContext", () => {
  it("returns empty string when all categories are empty", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [],
      highConviction: [],
    };
    expect(formatEarlyDetectionContext(data)).toBe("");
  });

  it("includes SEPA grade column in accelerating section", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [
        {
          symbol: "NVDA",
          sector: "Technology",
          latestEpsGrowth: 40,
          latestRevenueGrowth: 35,
          isEpsAccelerating: true,
          isRevenueAccelerating: true,
          sepaGrade: "A",
        },
      ],
      highConviction: [],
    };

    const result = formatEarlyDetectionContext(data);

    expect(result).toContain("| SEPA |");
    expect(result).toContain("| NVDA | +40% | +35% | EPS+매출 | A | Technology |");
    expect(result).toContain("SEPA F등급은 제외됨");
  });

  it("formats multiple accelerating stocks with varying SEPA grades", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [
        {
          symbol: "NVDA",
          sector: "Technology",
          latestEpsGrowth: 40,
          latestRevenueGrowth: 35,
          isEpsAccelerating: true,
          isRevenueAccelerating: false,
          sepaGrade: "B",
        },
        {
          symbol: "AAPL",
          sector: "Technology",
          latestEpsGrowth: 20,
          latestRevenueGrowth: null,
          isEpsAccelerating: true,
          isRevenueAccelerating: false,
          sepaGrade: "C",
        },
      ],
      highConviction: [],
    };

    const result = formatEarlyDetectionContext(data);

    expect(result).toContain("| NVDA | +40% | +35% | EPS | B | Technology |");
    expect(result).toContain("| AAPL | +20% | — | EPS | C | Technology |");
  });
});
