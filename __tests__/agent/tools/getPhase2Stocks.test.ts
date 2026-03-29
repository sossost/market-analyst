import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getPhase2Stocks } from "@/tools/getPhase2Stocks";

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  symbol: "AAPL",
  phase: 2,
  prev_phase: 1,
  rs_score: 75,
  ma150_slope: "0.003",
  pct_from_high_52w: "-0.10",
  pct_from_low_52w: "0.50",
  conditions_met: null,
  vol_ratio: "1.8",
  volume_confirmed: true,
  sector: "Technology",
  industry: "Software",
  ...overrides,
});

describe("getPhase2Stocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool name", () => {
    expect(getPhase2Stocks.definition.name).toBe("get_phase2_stocks");
  });

  it("rejects invalid date", async () => {
    const result = await getPhase2Stocks.execute({ date: "not-a-date" });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeTruthy();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns stocks with correct shape", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    const result = JSON.parse(
      await getPhase2Stocks.execute({ date: "2026-03-10" }),
    );

    expect(result.totalPhase2).toBe(1);
    expect(result.stocks[0]).toMatchObject({
      symbol: "AAPL",
      phase: 2,
      prevPhase: 1,
      isNewPhase2: true,
      rsScore: 75,
      volumeConfirmed: true,
    });
  });

  it("SQL includes market_cap filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getPhase2Stocks.execute({ date: "2026-03-10" });

    const sqlArg: string = mockQuery.mock.calls[0][0];
    expect(sqlArg).toMatch(/s\.market_cap::numeric\s*>=\s*\$\d/);
  });

  it("passes MIN_MARKET_CAP (300M) as query parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getPhase2Stocks.execute({ date: "2026-03-10" });

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs).toContain(300_000_000);
  });

  it("uses default RS range and limit", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getPhase2Stocks.execute({ date: "2026-03-10" });

    const queryArgs = mockQuery.mock.calls[0][1];
    // [date, minRs, maxRs, limit, MIN_MARKET_CAP]
    expect(queryArgs[1]).toBe(60); // default min_rs
    expect(queryArgs[3]).toBe(30); // default limit
  });

  it("counts newPhase2 correctly", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ symbol: "A", prev_phase: 1 }),
        makeRow({ symbol: "B", prev_phase: 2 }),
        makeRow({ symbol: "C", prev_phase: null }),
      ],
    });

    const result = JSON.parse(
      await getPhase2Stocks.execute({ date: "2026-03-10" }),
    );

    expect(result.totalPhase2).toBe(3);
    expect(result.newPhase2Count).toBe(1); // only prev_phase=1 is "new"
  });
});
