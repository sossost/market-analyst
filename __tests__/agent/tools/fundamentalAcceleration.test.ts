import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeYoYGrowths,
  isAccelerating,
} from "@/tools/getFundamentalAcceleration";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  pool: {
    query: mockQuery,
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/etl/utils/common", () => ({
  toNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  },
}));

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

  it("skips quarters where year-ago value is negative (turnaround case)", () => {
    // EPS -$0.01 → +$0.10 should NOT produce 1100% growth
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "0.10", null),
      makeQuarter("AAPL", "2025-09-30", "1.80", null),
      makeQuarter("AAPL", "2025-06-30", "1.50", null),
      makeQuarter("AAPL", "2025-03-31", "1.20", null),
      makeQuarter("AAPL", "2024-12-31", "-0.01", null), // negative year-ago
      makeQuarter("AAPL", "2024-09-30", "1.00", null),
      makeQuarter("AAPL", "2024-06-30", "1.00", null),
      makeQuarter("AAPL", "2024-03-31", "1.00", null),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");

    // Index 0 vs 4: year-ago is negative, skipped
    expect(growths).toHaveLength(3);
    expect(growths[0].yoyGrowth).toBe(80); // index 1 vs 5
  });

  it("skips quarters where year-ago is negative even with negative current (loss deepening)", () => {
    // EPS -$0.50 → -$0.10: both negative, should skip
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "-0.10", null),
      makeQuarter("AAPL", "2025-09-30", "1.80", null),
      makeQuarter("AAPL", "2025-06-30", "1.50", null),
      makeQuarter("AAPL", "2025-03-31", "1.20", null),
      makeQuarter("AAPL", "2024-12-31", "-0.50", null), // negative year-ago
      makeQuarter("AAPL", "2024-09-30", "1.00", null),
      makeQuarter("AAPL", "2024-06-30", "1.00", null),
      makeQuarter("AAPL", "2024-03-31", "1.00", null),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");

    // Index 0 vs 4: year-ago is negative, skipped
    expect(growths).toHaveLength(3);
    expect(growths[0].yoyGrowth).toBe(80); // index 1 vs 5
  });

  it("calculates correctly when all year-ago values are positive", () => {
    // Normal case: positive → positive
    const quarters = [
      makeQuarter("AAPL", "2025-12-31", "2.00", null),
      makeQuarter("AAPL", "2025-09-30", "1.80", null),
      makeQuarter("AAPL", "2025-06-30", "1.50", null),
      makeQuarter("AAPL", "2025-03-31", "1.20", null),
      makeQuarter("AAPL", "2024-12-31", "1.00", null),
      makeQuarter("AAPL", "2024-09-30", "1.00", null),
      makeQuarter("AAPL", "2024-06-30", "1.00", null),
      makeQuarter("AAPL", "2024-03-31", "1.00", null),
    ];

    const growths = computeYoYGrowths(quarters, "eps_diluted");

    expect(growths).toHaveLength(4);
    expect(growths[0].yoyGrowth).toBe(100); // 2.00 vs 1.00
    expect(growths[1].yoyGrowth).toBe(80);  // 1.80 vs 1.00
    expect(growths[2].yoyGrowth).toBe(50);  // 1.50 vs 1.00
    expect(growths[3].yoyGrowth).toBe(20);  // 1.20 vs 1.00
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
  it("detects accelerating growth pattern above minimum hurdle", () => {
    // Latest: 100%, prev: 80%, older: 50% — accelerating + above 15% hurdle
    const growths = [
      { yoyGrowth: 100 },
      { yoyGrowth: 80 },
      { yoyGrowth: 50 },
    ];

    expect(isAccelerating(growths)).toBe(true);
  });

  it("rejects low-growth acceleration below 15% hurdle", () => {
    // 12% > 8% > 5% — monotonic increasing but latest < 15%
    const growths = [
      { yoyGrowth: 12 },
      { yoyGrowth: 8 },
      { yoyGrowth: 5 },
    ];

    expect(isAccelerating(growths)).toBe(false);
  });

  it("accepts acceleration exactly at 15% hurdle with prior above floor", () => {
    // 15% > avg(10, 8) = 9%, prev(10) >= 8 — passes all conditions
    const growths = [
      { yoyGrowth: 15 },
      { yoyGrowth: 10 },
      { yoyGrowth: 8 },
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

  it("accepts re-acceleration pattern (dip then surge)", () => {
    // Q1 +35% → Q2 +30% → Q3 +40%: latest(40) > avg(30,35)=32.5
    // Previously rejected by strictly monotonic; now accepted
    const growths = [
      { yoyGrowth: 40 },
      { yoyGrowth: 30 },
      { yoyGrowth: 35 },
    ];

    expect(isAccelerating(growths)).toBe(true);
  });

  it("rejects low-growth base false positive", () => {
    // +2% → +3% → +15%: prev(3) < MIN_PRIOR_GROWTH(8)
    // Previously accepted; now rejected
    const growths = [
      { yoyGrowth: 15 },
      { yoyGrowth: 3 },
      { yoyGrowth: 2 },
    ];

    expect(isAccelerating(growths)).toBe(false);
  });

  it("rejects when prev is below MIN_PRIOR_GROWTH floor", () => {
    // Latest 20% is high, but prev 5% below floor
    const growths = [
      { yoyGrowth: 20 },
      { yoyGrowth: 5 },
      { yoyGrowth: 3 },
    ];

    expect(isAccelerating(growths)).toBe(false);
  });

  it("accepts when latest exceeds prior average but not each individually", () => {
    // latest(30) > avg(25,32)=28.5, prev(25) >= 8 — valid acceleration even if latest < older
    const growths = [
      { yoyGrowth: 30 },
      { yoyGrowth: 25 },
      { yoyGrowth: 32 },
    ];

    expect(isAccelerating(growths)).toBe(true);
  });
});

describe("findFundamentalAcceleration market cap filter", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("SQL includes market_cap filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { findFundamentalAcceleration } = await import(
      "@/db/repositories/fundamentalRepository"
    );
    await findFundamentalAcceleration();

    const sqlArg: string = mockQuery.mock.calls[0][0];
    expect(sqlArg).toMatch(/s\.market_cap::numeric\s*>=\s*\$\d/);
  });

  it("passes MIN_MARKET_CAP (300M) as query parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { findFundamentalAcceleration } = await import(
      "@/db/repositories/fundamentalRepository"
    );
    await findFundamentalAcceleration();

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs).toContain(300_000_000);
  });
});
