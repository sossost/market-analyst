import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQuery = vi.fn();

vi.mock("@/db/client", () => ({
  pool: { query: mockQuery },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: (fn: () => unknown) => fn(),
}));

const { getConfirmedBreakouts } = await import("../getConfirmedBreakouts");

function makeBreakoutRow(overrides: Partial<{
  symbol: string;
  date: string;
  breakout_percent: string | null;
  volume_ratio: string | null;
  is_perfect_retest: boolean;
  ma20_distance_percent: string | null;
  sector: string | null;
  industry: string | null;
  phase: number | null;
  rs_score: number | null;
}> = {}) {
  return {
    symbol: "NVDA",
    date: "2026-04-09",
    breakout_percent: "3.5",
    volume_ratio: "2.8",
    is_perfect_retest: false,
    ma20_distance_percent: "4.2",
    sector: "Technology",
    industry: "Semiconductors",
    phase: 2,
    rs_score: 88,
    ...overrides,
  };
}

describe("getConfirmedBreakouts", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("date 파라미터가 없으면 에러를 반환한다", async () => {
    const result = JSON.parse(await getConfirmedBreakouts.execute({}));

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("유효한 date에 돌파 종목이 있으면 올바른 형태로 반환한다", async () => {
    const row = makeBreakoutRow();
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getConfirmedBreakouts.execute({ date: "2026-04-09" }));

    expect(result.date).toBe("2026-04-09");
    expect(result.totalBreakouts).toBe(1);
    expect(result.breakouts).toHaveLength(1);

    const b = result.breakouts[0];
    expect(b.symbol).toBe("NVDA");
    expect(b.breakoutPercent).toBeCloseTo(3.5);
    expect(b.volumeRatio).toBeCloseTo(2.8);
    expect(b.isPerfectRetest).toBe(false);
    expect(b.ma20DistancePercent).toBeCloseTo(4.2);
    expect(b.sector).toBe("Technology");
    expect(b.phase).toBe(2);
    expect(b.rsScore).toBe(88);
  });

  it("isPerfectRetest가 true이면 올바르게 반환한다", async () => {
    const row = makeBreakoutRow({ is_perfect_retest: true });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getConfirmedBreakouts.execute({ date: "2026-04-09" }));

    expect(result.breakouts[0].isPerfectRetest).toBe(true);
  });

  it("null 필드가 있으면 null로 반환한다", async () => {
    const row = makeBreakoutRow({
      breakout_percent: null,
      volume_ratio: null,
      sector: null,
    });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getConfirmedBreakouts.execute({ date: "2026-04-09" }));

    const b = result.breakouts[0];
    expect(b.breakoutPercent).toBeNull();
    expect(b.volumeRatio).toBeNull();
    expect(b.sector).toBeNull();
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = JSON.parse(await getConfirmedBreakouts.execute({ date: "2026-04-09" }));

    expect(result.totalBreakouts).toBe(0);
    expect(result.breakouts).toHaveLength(0);
  });

  it("limit와 MIN_MARKET_CAP가 올바른 순서로 SQL에 전달된다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getConfirmedBreakouts.execute({ date: "2026-04-09", limit: 20 });

    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs).toHaveLength(3);
    expect(callArgs[0]).toBe("2026-04-09");
    expect(callArgs[1]).toBe(300_000_000); // MIN_MARKET_CAP
    expect(callArgs[2]).toBe(20); // limit
  });

  it("tool definition이 올바른 name과 schema를 갖는다", () => {
    expect(getConfirmedBreakouts.definition.name).toBe("get_confirmed_breakouts");
    expect(getConfirmedBreakouts.definition.input_schema.required).toContain("date");
  });
});
