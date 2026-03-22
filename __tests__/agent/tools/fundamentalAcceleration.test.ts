import { describe, it, expect } from "vitest";
import {
  computeYoYGrowths,
  isAccelerating,
} from "@/tools/getFundamentalAcceleration";

function makeQuarter(
  symbol: string,
  periodEndDate: string,
  epsDiluted: string | null,
  revenue: string | null,
) {
  return {
    symbol,
    period_end_date: periodEndDate,
    eps_diluted: epsDiluted,
    revenue,
    net_income: null,
    sector: "Technology",
    industry: "Software",
  };
}

describe("computeYoYGrowths", () => {
  it("calculates YoY growth for EPS across quarters", () => {
    // 8 quarters, newest first
    // Q4 2025: $2.00, Q3 2025: $1.80, Q2 2025: $1.50, Q1 2025: $1.20
    // Q4 2024: $1.00, Q3 2024: $1.00, Q2 2024: $1.00, Q1 2024: $1.00
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "2.00", "100"),
      makeQuarter("AAPL", "2025-09-30", "1.80", "90"),
      makeQuarter("AAPL", "2025-06-30", "1.50", "80"),
      makeQuarter("AAPL", "2025-03-31", "1.20", "70"),
      makeQuarter("AAPL", "2024-12-31", "1.00", "60"),
      makeQuarter("AAPL", "2024-09-30", "1.00", "60"),
      makeQuarter("AAPL", "2024-06-30", "1.00", "60"),
      makeQuarter("AAPL", "2024-03-31", "1.00", "60"),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");

    expect(growths).toHaveLength(4);
    expect(growths[0].yoyGrowth).toBe(100); // 2.00 vs 1.00 = +100%
    expect(growths[1].yoyGrowth).toBe(80); // 1.80 vs 1.00 = +80%
    expect(growths[2].yoyGrowth).toBe(50); // 1.50 vs 1.00 = +50%
    expect(growths[3].yoyGrowth).toBe(20); // 1.20 vs 1.00 = +20%
  });

  it("skips quarters with null values", () => {
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "2.00", null),
      makeQuarter("AAPL", "2025-09-30", null, null),
      makeQuarter("AAPL", "2025-06-30", "1.50", null),
      makeQuarter("AAPL", "2025-03-31", "1.20", null),
      makeQuarter("AAPL", "2024-12-31", "1.00", null),
      makeQuarter("AAPL", "2024-09-30", "1.00", null),
      makeQuarter("AAPL", "2024-06-30", "1.00", null),
      makeQuarter("AAPL", "2024-03-31", "1.00", null),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");

    // Quarter at index 1 has null EPS, so only 3 valid growths
    expect(growths).toHaveLength(3);
    expect(growths[0].yoyGrowth).toBe(100); // index 0 vs 4
    // index 1 skipped (null)
    expect(growths[1].yoyGrowth).toBe(50); // index 2 vs 6
    expect(growths[2].yoyGrowth).toBe(20); // index 3 vs 7
  });

  it("skips quarters where year-ago value is zero", () => {
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "2.00", null),
      makeQuarter("AAPL", "2025-09-30", "1.80", null),
      makeQuarter("AAPL", "2025-06-30", "1.50", null),
      makeQuarter("AAPL", "2025-03-31", "1.20", null),
      makeQuarter("AAPL", "2024-12-31", "0", null), // zero year-ago
      makeQuarter("AAPL", "2024-09-30", "1.00", null),
      makeQuarter("AAPL", "2024-06-30", "1.00", null),
      makeQuarter("AAPL", "2024-03-31", "1.00", null),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");

    // Index 0 vs 4: year-ago is 0, skipped
    expect(growths).toHaveLength(3);
    expect(growths[0].yoyGrowth).toBe(80); // index 1 vs 5
  });

  it("returns empty for insufficient quarters", () => {
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "2.00", null),
      makeQuarter("AAPL", "2025-09-30", "1.80", null),
      makeQuarter("AAPL", "2025-06-30", "1.50", null),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");
    expect(growths).toHaveLength(0);
  });
});

describe("isAccelerating", () => {
  it("detects accelerating growth pattern", () => {
    // Latest: 100%, prev: 80%, older: 50% — accelerating
    const growths = [
      { yoyGrowth: 100 },
      { yoyGrowth: 80 },
      { yoyGrowth: 50 },
    ];

    expect(isAccelerating(growths)).toBe(true);
  });

  it("rejects decelerating growth", () => {
    // Latest: 50%, prev: 80%, older: 100% — decelerating
    const growths = [
      { yoyGrowth: 50 },
      { yoyGrowth: 80 },
      { yoyGrowth: 100 },
    ];

    expect(isAccelerating(growths)).toBe(false);
  });

  it("rejects flat growth", () => {
    const growths = [
      { yoyGrowth: 50 },
      { yoyGrowth: 50 },
      { yoyGrowth: 50 },
    ];

    expect(isAccelerating(growths)).toBe(false);
  });

  it("rejects negative latest growth even if accelerating", () => {
    // -10% > -20% > -30% is "accelerating" in magnitude but still negative
    const growths = [
      { yoyGrowth: -10 },
      { yoyGrowth: -20 },
      { yoyGrowth: -30 },
    ];

    expect(isAccelerating(growths)).toBe(false);
  });

  it("returns false for fewer than 3 data points", () => {
    expect(isAccelerating([{ yoyGrowth: 100 }, { yoyGrowth: 50 }])).toBe(false);
    expect(isAccelerating([])).toBe(false);
  });

  it("only checks first 3 entries", () => {
    // First 3 accelerating, rest doesn't matter
    const growths = [
      { yoyGrowth: 100 },
      { yoyGrowth: 80 },
      { yoyGrowth: 50 },
      { yoyGrowth: 200 }, // ignored
    ];

    expect(isAccelerating(growths)).toBe(true);
  });
});
