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

import { getRisingRS } from "@/tools/getRisingRS";

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  symbol: "AAPL",
  phase: 2,
  rs_score: 45,
  rs_score_4w_ago: 35,
  rs_change: 10,
  ma150_slope: "0.003",
  pct_from_low_52w: "0.25",
  vol_ratio: "1.8",
  sector: "Technology",
  industry: "Software",
  sector_avg_rs: "55",
  sector_change_4w: "3.5",
  sector_group_phase: 2,
  sepa_grade: "S",
  market_cap: "150000000000",
  ...overrides,
});

describe("getRisingRS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool name", () => {
    expect(getRisingRS.definition.name).toBe("get_rising_rs");
  });

  it("passes allowedPhases [1, 2] to SQL query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs).toContainEqual([1, 2]);
  });

  it("passes RS_MAX = 70 to SQL query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const queryArgs = mockQuery.mock.calls[0][1];
    // [date, rsMin, rsMax, limit, minRsChange, allowedPhases]
    expect(queryArgs[1]).toBe(30); // rsMin
    expect(queryArgs[2]).toBe(70); // rsMax
  });

  it("SQL includes phase filter with ANY clause", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("sp.phase = ANY($6::int[])");
  });

  it("SQL includes market_cap filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const sqlArg: string = mockQuery.mock.calls[0][0];
    expect(sqlArg).toMatch(/s\.market_cap::numeric\s*>=\s*\$\d/);
  });

  it("passes MIN_MARKET_CAP (300M) as query parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs).toContain(300_000_000);
  });

  it("returns stocks with correct shape including sepaGrade and marketCap", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRow()],
    });

    const result = JSON.parse(await getRisingRS.execute({ date: "2025-01-15" }));

    expect(result.totalFound).toBe(1);
    expect(result.rsRange).toBe("30~70");
    expect(result.stocks[0]).toMatchObject({
      symbol: "AAPL",
      phase: 2,
      rsScore: 45,
      rsScore4wAgo: 35,
      rsChange: 10,
      sepaGrade: "S",
      marketCap: 150000000000,
    });
  });

  it("returns description mentioning Phase 1/2", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = JSON.parse(await getRisingRS.execute({ date: "2025-01-15" }));

    expect(result.description).toContain("Phase 1/2");
  });

  it("returns error for invalid date", async () => {
    const result = JSON.parse(await getRisingRS.execute({ date: "not-a-date" }));

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("uses default limit of 30", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs[3]).toBe(30); // limit
  });

  it("uses custom limit when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15", limit: 10 });

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs[3]).toBe(10);
  });

  it("handles null numeric fields gracefully", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({
          ma150_slope: null,
          pct_from_low_52w: null,
          vol_ratio: null,
          sector_avg_rs: null,
          sector_change_4w: null,
          rs_score_4w_ago: null,
          rs_change: 0,
          sepa_grade: null,
          market_cap: null,
        }),
      ],
    });

    const result = JSON.parse(await getRisingRS.execute({ date: "2025-01-15" }));

    expect(result.stocks[0].ma150Slope).toBeNull();
    expect(result.stocks[0].pctFromLow52w).toBeNull();
    expect(result.stocks[0].volRatio).toBeNull();
    expect(result.stocks[0].sectorAvgRs).toBeNull();
    expect(result.stocks[0].sectorChange4w).toBeNull();
    expect(result.stocks[0].rsScore4wAgo).toBeNull();
    expect(result.stocks[0].rsChange).toBe(0);
    expect(result.stocks[0].sepaGrade).toBeNull();
    expect(result.stocks[0].marketCap).toBeNull();
  });

  it("handles multiple stocks correctly", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRow({ symbol: "AAPL", phase: 1 }),
        makeRow({ symbol: "MSFT", phase: 2 }),
        makeRow({ symbol: "GOOG", phase: 2 }),
      ],
    });

    const result = JSON.parse(await getRisingRS.execute({ date: "2025-01-15" }));

    expect(result.totalFound).toBe(3);
    expect(result.stocks.map((s: { symbol: string }) => s.symbol)).toEqual([
      "AAPL",
      "MSFT",
      "GOOG",
    ]);
  });

  it("SQL includes sepa_grade and market_cap in SELECT", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getRisingRS.execute({ date: "2025-01-15" });

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("fs.grade AS sepa_grade");
    expect(sql).toContain("s.market_cap");
  });

  it("marks extreme pctFromLow correctly", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRow({ pct_from_low_52w: "6.0" })],
    });

    const result = JSON.parse(await getRisingRS.execute({ date: "2025-01-15" }));

    expect(result.stocks[0].pctFromLow52w).toBe(600);
    expect(result.stocks[0].isExtremePctFromLow).toBe(true);
  });
});
