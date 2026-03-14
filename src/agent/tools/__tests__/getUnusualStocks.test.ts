import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * getUnusualStocks 도구의 phase2WithDrop 플래그 계산 로직을 검증한다.
 *
 * pool.query를 mock하여 DB 없이 순수 매핑 로직만 테스트한다.
 */

const mockQuery = vi.fn();

vi.mock("@/db/client", () => ({
  pool: { query: mockQuery },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: (fn: () => unknown) => fn(),
}));

// mock 설정 완료 후 import (hoisting 보장)
const { getUnusualStocks } = await import("../getUnusualStocks");

/** 테스트용 DB 행 팩토리 — 플래그 계산에 필요한 최소 필드만 정의 */
function makeRow(overrides: {
  phase: number;
  daily_return: string;
  prev_phase?: number | null;
  vol_ratio?: string;
}) {
  return {
    symbol: "TEST",
    company_name: "Test Corp",
    close: "100",
    prev_close: "95",
    daily_return: overrides.daily_return,
    volume: "2000000",
    vol_ma30: "1000000",
    vol_ratio: overrides.vol_ratio ?? "2.5",
    phase: overrides.phase,
    prev_phase: overrides.prev_phase ?? null,
    rs_score: 60,
    sector: "Technology",
    industry: "Software",
  };
}

describe("getUnusualStocks — phase2WithDrop 플래그", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("phase 2이고 daily_return이 -0.06이면 phase2WithDrop: true를 반환한다", async () => {
    const row = makeRow({ phase: 2, daily_return: "-0.06" });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getUnusualStocks.execute({ date: "2025-01-10" }));

    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].phase2WithDrop).toBe(true);
  });

  it("phase 2이고 daily_return이 0.03이면 phase2WithDrop: false를 반환한다", async () => {
    const row = makeRow({ phase: 2, daily_return: "0.03", vol_ratio: "2.5" });
    // big_move 조건은 충족 안 하지만 high_volume + phase_change로 2개 충족시키기
    row.prev_phase = 1;
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getUnusualStocks.execute({ date: "2025-01-10" }));

    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].phase2WithDrop).toBe(false);
  });

  it("phase 1이고 daily_return이 -0.06이면 phase2WithDrop: false를 반환한다", async () => {
    const row = makeRow({ phase: 1, daily_return: "-0.06" });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getUnusualStocks.execute({ date: "2025-01-10" }));

    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].phase2WithDrop).toBe(false);
  });

  it("daily_return이 정확히 -0.05이면 phase2WithDrop: true를 반환한다 (경계값 포함)", async () => {
    const row = makeRow({ phase: 2, daily_return: "-0.05" });
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = JSON.parse(await getUnusualStocks.execute({ date: "2025-01-10" }));

    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].phase2WithDrop).toBe(true);
  });

  it("date 파라미터가 없으면 에러 응답을 반환한다", async () => {
    const result = JSON.parse(await getUnusualStocks.execute({}));

    expect(result.error).toBeDefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
