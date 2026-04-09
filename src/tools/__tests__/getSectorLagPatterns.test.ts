import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQuery = vi.fn();

vi.mock("@/db/client", () => ({
  pool: { query: mockQuery },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: (fn: () => unknown) => fn(),
}));

const { getSectorLagPatterns } = await import("../getSectorLagPatterns");

function makeLagRow(overrides: Partial<{
  entity_type: string;
  leader_entity: string;
  follower_entity: string;
  transition: string;
  sample_count: number;
  avg_lag_days: string | null;
  median_lag_days: string | null;
  stddev_lag_days: string | null;
  p_value: string | null;
  last_observed_at: string | null;
  last_lag_days: number | null;
}> = {}) {
  return {
    entity_type: "sector",
    leader_entity: "Technology",
    follower_entity: "Healthcare",
    transition: "1to2",
    sample_count: 8,
    avg_lag_days: "12.5",
    median_lag_days: "11.0",
    stddev_lag_days: "3.2",
    p_value: "0.003",
    last_observed_at: "2026-03-15",
    last_lag_days: 10,
    ...overrides,
  };
}

describe("getSectorLagPatterns", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("기본 파라미터로 호출하면 transition=1to2, entityType=sector로 쿼리한다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = JSON.parse(await getSectorLagPatterns.execute({}));

    expect(result.transition).toBe("1to2");
    expect(result.entityType).toBe("sector");
    expect(result.totalPatterns).toBe(0);

    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs[0]).toBe("1to2");
    expect(callArgs[1]).toBe("sector");
  });

  it("래그 패턴이 있으면 올바른 형태로 반환한다", async () => {
    const row = makeLagRow();
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getSectorLagPatterns.execute({}));

    expect(result.totalPatterns).toBe(1);
    expect(result.patterns).toHaveLength(1);

    const p = result.patterns[0];
    expect(p.leaderEntity).toBe("Technology");
    expect(p.followerEntity).toBe("Healthcare");
    expect(p.entityType).toBe("sector");
    expect(p.transition).toBe("1to2");
    expect(p.sampleCount).toBe(8);
    expect(p.avgLagDays).toBeCloseTo(12.5);
    expect(p.medianLagDays).toBeCloseTo(11.0);
    expect(p.stddevLagDays).toBeCloseTo(3.2);
    expect(p.pValue).toBeCloseTo(0.003);
    expect(p.lastObservedAt).toBe("2026-03-15");
    expect(p.lastLagDays).toBe(10);
  });

  it("transition=3to4로 요청하면 올바르게 전달된다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = JSON.parse(
      await getSectorLagPatterns.execute({ transition: "3to4" }),
    );

    expect(result.transition).toBe("3to4");
    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs[0]).toBe("3to4");
  });

  it("entity_type=industry로 요청하면 올바르게 전달된다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = JSON.parse(
      await getSectorLagPatterns.execute({ entity_type: "industry" }),
    );

    expect(result.entityType).toBe("industry");
    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs[1]).toBe("industry");
  });

  it("잘못된 transition이면 에러를 반환한다", async () => {
    const result = JSON.parse(
      await getSectorLagPatterns.execute({ transition: "invalid" }),
    );

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("잘못된 entity_type이면 에러를 반환한다", async () => {
    const result = JSON.parse(
      await getSectorLagPatterns.execute({ entity_type: "invalid" }),
    );

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("null 필드가 있으면 null로 반환한다", async () => {
    const row = makeLagRow({
      avg_lag_days: null,
      p_value: null,
      last_observed_at: null,
      last_lag_days: null,
    });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getSectorLagPatterns.execute({}));

    const p = result.patterns[0];
    expect(p.avgLagDays).toBeNull();
    expect(p.pValue).toBeNull();
    expect(p.lastObservedAt).toBeNull();
    expect(p.lastLagDays).toBeNull();
  });

  it("limit 파라미터가 SQL에 전달된다", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getSectorLagPatterns.execute({ limit: 5 });

    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs[2]).toBe(5);
  });

  it("tool definition이 올바른 name을 갖는다", () => {
    expect(getSectorLagPatterns.definition.name).toBe("get_sector_lag_patterns");
    expect(getSectorLagPatterns.definition.input_schema.required).toEqual([]);
  });
});
