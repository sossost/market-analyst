import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQuery = vi.fn();

vi.mock("@/db/client", () => ({
  pool: { query: mockQuery },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: (fn: () => unknown) => fn(),
}));

const { getVCPCandidates } = await import("../getVCPCandidates");

function makeVcpRow(overrides: Partial<{
  symbol: string;
  date: string;
  bb_width_current: string | null;
  bb_width_avg_60d: string | null;
  atr14_percent: string | null;
  body_ratio: string | null;
  ma20_ma50_distance_percent: string | null;
  sector: string | null;
  industry: string | null;
  phase: number | null;
  rs_score: number | null;
}> = {}) {
  return {
    symbol: "AAPL",
    date: "2026-04-09",
    bb_width_current: "0.035",
    bb_width_avg_60d: "0.065",
    atr14_percent: "2.1",
    body_ratio: "0.45",
    ma20_ma50_distance_percent: "1.2",
    sector: "Technology",
    industry: "Software",
    phase: 2,
    rs_score: 82,
    ...overrides,
  };
}

describe("getVCPCandidates", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("date 파라미터가 없으면 에러를 반환한다", async () => {
    const result = JSON.parse(await getVCPCandidates.execute({}));

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("유효한 date에 VCP 후보가 있으면 올바른 형태로 반환한다", async () => {
    const row = makeVcpRow();
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getVCPCandidates.execute({ date: "2026-04-09" }));

    expect(result.date).toBe("2026-04-09");
    expect(result.totalVcpCandidates).toBe(1);
    expect(result.candidates).toHaveLength(1);

    const c = result.candidates[0];
    expect(c.symbol).toBe("AAPL");
    expect(c.bbWidthCurrent).toBeCloseTo(0.035);
    expect(c.bbWidthAvg60d).toBeCloseTo(0.065);
    expect(c.atr14Percent).toBeCloseTo(2.1);
    expect(c.bodyRatio).toBeCloseTo(0.45);
    expect(c.ma20Ma50DistancePercent).toBeCloseTo(1.2);
    expect(c.sector).toBe("Technology");
    expect(c.industry).toBe("Software");
    expect(c.phase).toBe(2);
    expect(c.rsScore).toBe(82);
  });

  it("null 필드가 있으면 null로 반환한다", async () => {
    const row = makeVcpRow({
      bb_width_current: null,
      atr14_percent: null,
      phase: null,
    });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getVCPCandidates.execute({ date: "2026-04-09" }));

    const c = result.candidates[0];
    expect(c.bbWidthCurrent).toBeNull();
    expect(c.atr14Percent).toBeNull();
    expect(c.phase).toBeNull();
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = JSON.parse(await getVCPCandidates.execute({ date: "2026-04-09" }));

    expect(result.totalVcpCandidates).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("limit와 MIN_MARKET_CAP가 올바른 순서로 SQL에 전달된다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getVCPCandidates.execute({ date: "2026-04-09", limit: 10 });

    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs).toHaveLength(3);
    expect(callArgs[0]).toBe("2026-04-09");
    expect(callArgs[1]).toBe(300_000_000); // MIN_MARKET_CAP
    expect(callArgs[2]).toBe(10); // limit
  });

  it("잘못된 date 형식이면 에러를 반환한다", async () => {
    const result = JSON.parse(await getVCPCandidates.execute({ date: "invalid" }));

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("tool definition이 올바른 name과 schema를 갖는다", () => {
    expect(getVCPCandidates.definition.name).toBe("get_vcp_candidates");
    expect(getVCPCandidates.definition.input_schema.required).toContain("date");
  });
});
