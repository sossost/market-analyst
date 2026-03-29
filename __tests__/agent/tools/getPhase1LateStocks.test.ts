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

import { getPhase1LateStocks } from "@/tools/getPhase1LateStocks";

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  symbol: "AAPL",
  phase: 1,
  prev_phase: 1,
  rs_score: 35,
  ma150_slope: "0.002",
  pct_from_high_52w: "-0.35",
  pct_from_low_52w: "0.12",
  conditions_met: null,
  vol_ratio: "1.5",
  sector: "Technology",
  industry: "Software",
  sector_group_phase: 2,
  sector_avg_rs: "55",
  ...overrides,
});

describe("getPhase1LateStocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool name", () => {
    expect(getPhase1LateStocks.definition.name).toBe("get_phase1_late_stocks");
  });

  it("rejects invalid date", async () => {
    const result = await getPhase1LateStocks.execute({ date: "not-a-date" });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeTruthy();
  });

  it("returns stocks with phase=1 and prev_phase=1 (base formation — 포함)", async () => {
    mockQuery.mockResolvedValue({
      rows: [makeRow({ symbol: "AAPL", prev_phase: 1 })],
    });

    const result = await getPhase1LateStocks.execute({ date: "2026-03-07" });
    const parsed = JSON.parse(result);

    expect(parsed.stocks).toHaveLength(1);
    expect(parsed.stocks[0].symbol).toBe("AAPL");
    expect(parsed.stocks[0].prevPhase).toBe(1);
  });

  it("excludes Phase 3→1 전환 종목 (천장 붕괴 후 낙하 — 제외)", async () => {
    // SQL WHERE 절에 prev_phase 필터가 적용되어 DB가 이미 필터링한다.
    // 테스트는 SQL 문자열에 필터 조건이 포함되어 있는지를 검증한다.
    mockQuery.mockResolvedValue({ rows: [] });

    await getPhase1LateStocks.execute({ date: "2026-03-07" });

    const sqlArg: string = mockQuery.mock.calls[0][0];
    expect(sqlArg).toMatch(/prev_phase/);
    expect(sqlArg).toMatch(/IS NULL/);
    expect(sqlArg).toMatch(/prev_phase\s*=\s*1/);
  });

  it("prev_phase = NULL 종목은 신규 데이터로 허용 (포함)", async () => {
    mockQuery.mockResolvedValue({
      rows: [makeRow({ symbol: "NEW", prev_phase: null })],
    });

    const result = await getPhase1LateStocks.execute({ date: "2026-03-07" });
    const parsed = JSON.parse(result);

    // DB가 NULL 허용하여 반환하면, 결과에 포함되어야 한다.
    expect(parsed.stocks).toHaveLength(1);
    expect(parsed.stocks[0].prevPhase).toBeNull();
  });

  it("SQL에 (prev_phase IS NULL OR prev_phase = 1) 조건이 포함된다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getPhase1LateStocks.execute({ date: "2026-03-07" });

    const sqlArg: string = mockQuery.mock.calls[0][0];
    // prev_phase IS NULL 허용
    expect(sqlArg).toMatch(/sp\.prev_phase\s+IS\s+NULL/i);
    // prev_phase = 1 허용
    expect(sqlArg).toMatch(/sp\.prev_phase\s*=\s*1/i);
  });

  it("SQL에 ma150_slope >= 0 조건이 포함된다 (음수 slope 차단)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getPhase1LateStocks.execute({ date: "2026-03-07" });

    const sqlArg: string = mockQuery.mock.calls[0][0];
    // ma150_slope >= 0 (하락 중인 종목 차단)
    expect(sqlArg).toMatch(/ma150_slope::numeric\s*>=\s*0/);
    // 과거의 관대한 조건(> -0.001)이 없어야 한다
    expect(sqlArg).not.toMatch(/-0\.001/);
  });

  it("SQL includes market_cap filter", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getPhase1LateStocks.execute({ date: "2026-03-07" });

    const sqlArg: string = mockQuery.mock.calls[0][0];
    expect(sqlArg).toMatch(/s\.market_cap::numeric\s*>=\s*\$\d/);
  });

  it("passes MIN_MARKET_CAP (300M) as query parameter", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getPhase1LateStocks.execute({ date: "2026-03-07" });

    const queryArgs = mockQuery.mock.calls[0][1];
    expect(queryArgs).toContain(300_000_000);
  });

  it("returns totalFound equal to number of stocks", async () => {
    mockQuery.mockResolvedValue({
      rows: [makeRow({ symbol: "A" }), makeRow({ symbol: "B" })],
    });

    const result = await getPhase1LateStocks.execute({ date: "2026-03-07" });
    const parsed = JSON.parse(result);

    expect(parsed.totalFound).toBe(2);
  });

  it("maps DB rows to correct output shape", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        makeRow({
          symbol: "NVDA",
          phase: 1,
          prev_phase: 1,
          rs_score: 42,
          ma150_slope: "0.005",
          pct_from_high_52w: "-0.25",
          pct_from_low_52w: "0.08",
          conditions_met: '["vol_surge"]',
          vol_ratio: "1.8",
          sector: "Technology",
          industry: "Semiconductors",
          sector_group_phase: 1,
          sector_avg_rs: "48",
        }),
      ],
    });

    const result = await getPhase1LateStocks.execute({ date: "2026-03-07" });
    const parsed = JSON.parse(result);
    const stock = parsed.stocks[0];

    expect(stock.symbol).toBe("NVDA");
    expect(stock.phase).toBe(1);
    expect(stock.prevPhase).toBe(1);
    expect(stock.rsScore).toBe(42);
    expect(stock.ma150Slope).toBeCloseTo(0.005);
    expect(stock.pctFromHigh52w).toBe(-25);
    expect(stock.pctFromLow52w).toBe(8);
    expect(stock.conditionsMet).toEqual(["vol_surge"]);
    expect(stock.volRatio).toBeCloseTo(1.8);
    expect(stock.sector).toBe("Technology");
    expect(stock.industry).toBe("Semiconductors");
    expect(stock.sectorGroupPhase).toBe(1);
    expect(stock.sectorAvgRs).toBeCloseTo(48);
  });
});
