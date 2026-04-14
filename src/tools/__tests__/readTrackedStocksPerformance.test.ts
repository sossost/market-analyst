/**
 * readTrackedStocksPerformance.test.ts — 트래킹 종목 성과 조회 도구 테스트
 *
 * 외부 의존성(pool)은 모두 mock 처리.
 * readRecommendationPerformance 핵심 시나리오를 커버하며,
 * source별/tier별 통계, exit_reason 기반 분류를 추가한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모듈 mock 설정 ---

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

// --- import (mock 이후) ---

import { readTrackedStocksPerformance } from "../readTrackedStocksPerformance";
import { pool } from "@/db/client";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeActiveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    symbol: "AAPL",
    source: "etl_auto",
    tier: "standard",
    status: "ACTIVE",
    entry_date: "2026-01-01",
    entry_phase: 2,
    current_phase: 2,
    entry_price: "150.00",
    current_price: "160.00",
    pnl_percent: "6.67",
    max_pnl_percent: "8.0",
    days_tracked: 21,
    exit_date: null,
    exit_reason: null,
    return_7d: "3.5",
    return_30d: "7.0",
    return_90d: null,
    ...overrides,
  };
}

function makeExitedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    symbol: "NVDA",
    source: "etl_auto",
    tier: "standard",
    status: "EXITED",
    entry_date: "2025-12-01",
    entry_phase: 2,
    current_phase: 3,
    entry_price: "200.00",
    current_price: "220.00",
    pnl_percent: "10.0",
    max_pnl_percent: "12.0",
    days_tracked: 30,
    exit_date: "2026-01-01",
    exit_reason: "phase_exit",
    return_7d: "5.0",
    return_30d: "10.0",
    return_90d: "20.0",
    ...overrides,
  };
}

/**
 * pool.query mock을 SQL 쿼리의 키워드로 분기하는 helper.
 * Promise.all로 동시에 여러 쿼리가 호출될 때 순서 의존 없이 응답한다.
 */
function mockQueryByKeyword(mapping: Array<[string, { rows: unknown[] }]>) {
  mockPool.query.mockImplementation((sql: string) => {
    for (const [keyword, response] of mapping) {
      if (sql.includes(keyword)) {
        return Promise.resolve(response);
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

// ─── 기본 조회 (all period) ───────────────────────────────────────────────────

describe("readTrackedStocksPerformance.execute — all period", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("도구 이름이 read_tracked_stocks_performance이다", () => {
    expect(readTrackedStocksPerformance.definition.name).toBe(
      "read_tracked_stocks_performance",
    );
  });

  it("ACTIVE + EXITED 혼합 조회 시 summary 반환", async () => {
    // active 쿼리: status = 'ACTIVE', 비active 쿼리: status <> 'ACTIVE'
    mockPool.query
      .mockResolvedValueOnce({ rows: [makeActiveRow()] })   // 첫 번째 호출: active
      .mockResolvedValueOnce({ rows: [makeExitedRow()] }); // 두 번째 호출: nonActive

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({}),
    );

    expect(result.summary.totalCount).toBe(2);
    expect(result.summary.activeCount).toBe(1);
    expect(result.summary.closedCount).toBe(1);
  });

  it("winRate 계산 — 이익 종목 비율", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          makeExitedRow({ pnl_percent: "10.0" }),
          makeExitedRow({ symbol: "TSLA", id: 3, pnl_percent: "-5.0" }),
        ],
      });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({}),
    );

    expect(result.summary.winRate).toBe(50);
  });

  it("ACTIVE만 조회 시 active 배열 반환, nonActive는 빈 배열", async () => {
    // status=ACTIVE: fetchNonActive=false → pool.query 1번만 호출
    mockPool.query.mockResolvedValueOnce({ rows: [makeActiveRow()] });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ status: "ACTIVE" }),
    );

    expect(result.active).toHaveLength(1);
    expect(result.recentClosed).toHaveLength(0);
  });

  it("EXITED만 조회 시 recentClosed 배열 반환, active는 빈 배열", async () => {
    // status=EXITED: fetchActive=false → pool.query 1번만 호출 (nonActive용)
    mockPool.query.mockResolvedValueOnce({ rows: [makeExitedRow()] });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ status: "EXITED" }),
    );

    expect(result.active).toHaveLength(0);
    expect(result.recentClosed).toHaveLength(1);
  });

  it("EXPIRED 상태도 구분된다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [makeExitedRow({ status: "EXPIRED", exit_reason: "tracking_window_expired" })],
      });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({}),
    );

    expect(result.summary.expiredCount).toBe(1);
    expect(result.summary.exitedCount).toBe(0);
  });
});

// ─── source별/tier별 통계 테스트 ──────────────────────────────────────────────

describe("readTrackedStocksPerformance.execute — source별/tier별 통계", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bySource 통계에 etl_auto, agent, thesis_aligned가 포함된다", async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          makeActiveRow({ source: "etl_auto" }),
          makeActiveRow({ symbol: "MSFT", id: 2, source: "agent" }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({}),
    );

    expect(result.bySource).toBeDefined();
    expect(result.bySource.etl_auto).toBeDefined();
    expect(result.bySource.agent).toBeDefined();
    expect(result.bySource.thesis_aligned).toBeDefined();
    expect(result.bySource.etl_auto.total).toBe(1);
    expect(result.bySource.agent.total).toBe(1);
    expect(result.bySource.thesis_aligned.total).toBe(0);
  });

  it("byTier 통계에 standard, featured가 포함된다", async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          makeActiveRow({ tier: "standard" }),
          makeActiveRow({ symbol: "MSFT", id: 2, tier: "featured" }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({}),
    );

    expect(result.byTier).toBeDefined();
    expect(result.byTier.standard.total).toBe(1);
    expect(result.byTier.featured.total).toBe(1);
  });

  it("exit_reason 기반 exitReasons 분류", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          makeExitedRow({ exit_reason: "phase_exit" }),
          makeExitedRow({ symbol: "MSFT", id: 3, exit_reason: "manual" }),
          makeExitedRow({ symbol: "TSLA", id: 4, exit_reason: "phase_exit" }),
        ],
      });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({}),
    );

    expect(result.summary.exitReasons.phase_exit).toBe(2);
    expect(result.summary.exitReasons.manual).toBe(1);
  });
});

// ─── this_week period 테스트 ──────────────────────────────────────────────────

describe("readTrackedStocksPerformance.execute — this_week period", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("this_week 조회 시 period: 'this_week' 반환", async () => {
    // executeThisWeek: Promise.all([newThisWeek, closedThisWeek, phaseExits]) — 3번 호출
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // newThisWeek
      .mockResolvedValueOnce({ rows: [] }) // closedThisWeek
      .mockResolvedValueOnce({ rows: [] }); // phaseExits

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ period: "this_week" }),
    );

    expect(result.period).toBe("this_week");
    expect(result.weekStart).toBeDefined();
    expect(result.weeklySummary).toBeDefined();
  });

  it("this_week 신규 종목이 있으면 newThisWeek에 포함", async () => {
    mockQueryByKeyword([
      ["entry_date >= $1", { rows: [makeActiveRow()] }],              // newThisWeek
      ["exit_date >= $1", { rows: [] }],                             // closedThisWeek
      ["status = 'ACTIVE'", { rows: [] }],                           // phaseExits
    ]);

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ period: "this_week" }),
    );

    expect(result.weeklySummary.newCount).toBe(1);
    expect(result.newThisWeek).toHaveLength(1);
    expect(result.newThisWeek[0].source).toBeDefined();
    expect(result.newThisWeek[0].tier).toBeDefined();
  });

  it("this_week 종료 종목이 있으면 closedThisWeek에 포함", async () => {
    mockQueryByKeyword([
      ["entry_date >= $1", { rows: [] }],
      ["exit_date >= $1", { rows: [makeExitedRow()] }],
      ["status = 'ACTIVE'", { rows: [] }],
    ]);

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ period: "this_week" }),
    );

    expect(result.weeklySummary.closedCount).toBe(1);
    expect(result.closedThisWeek).toHaveLength(1);
    expect(result.closedThisWeek[0].exitReason).toBe("phase_exit");
  });

  it("this_week phase 변경 종목이 phaseExits에 포함", async () => {
    mockQueryByKeyword([
      ["entry_date >= $1", { rows: [] }],
      ["exit_date >= $1", { rows: [] }],
      // phaseExits 쿼리: status = 'ACTIVE' AND current_phase IS NOT NULL
      ["current_phase IS NOT NULL", { rows: [makeActiveRow({ entry_phase: 2, current_phase: 3 })] }],
    ]);

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ period: "this_week" }),
    );

    expect(result.phaseExits).toHaveLength(1);
    expect(result.phaseExits[0].entryPhase).toBe(2);
    expect(result.phaseExits[0].currentPhase).toBe(3);
    expect(result.phaseExits[0].source).toBeDefined();
  });

  it("this_week bySource 통계가 포함된다", async () => {
    mockQueryByKeyword([
      ["entry_date >= $1", {
        rows: [
          makeActiveRow({ source: "etl_auto" }),
          makeActiveRow({ symbol: "MSFT", id: 2, source: "thesis_aligned" }),
        ],
      }],
      ["exit_date >= $1", { rows: [] }],
      ["current_phase IS NOT NULL", { rows: [] }],
    ]);

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ period: "this_week" }),
    );

    expect(result.bySource).toBeDefined();
    expect(result.bySource.etl_auto.total).toBe(1);
    expect(result.bySource.thesis_aligned.total).toBe(1);
  });

  it("exitReasons가 weeklySummary에 포함된다", async () => {
    mockQueryByKeyword([
      ["entry_date >= $1", { rows: [] }],
      ["exit_date >= $1", {
        rows: [makeExitedRow({ exit_reason: "tracking_window_expired", status: "EXPIRED" })],
      }],
      ["current_phase IS NOT NULL", { rows: [] }],
    ]);

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ period: "this_week" }),
    );

    expect(result.weeklySummary.exitReasons.tracking_window_expired).toBe(1);
  });
});

// ─── 아이템 필드 포맷 테스트 ──────────────────────────────────────────────────

describe("readTrackedStocksPerformance.execute — 아이템 필드 포맷", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("active 아이템에 return_7d, return_30d가 포함된다", async () => {
    // ACTIVE만 조회 — fetchNonActive=false → pool.query 1번 호출
    mockPool.query.mockResolvedValueOnce({
      rows: [makeActiveRow({ return_7d: "3.5", return_30d: "7.0" })],
    });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ status: "ACTIVE" }),
    );

    expect(result.active[0].return7d).toBeCloseTo(3.5);
    expect(result.active[0].return30d).toBeCloseTo(7.0);
  });

  it("closed 아이템에 return_7d, return_30d, return_90d가 포함된다", async () => {
    // EXITED만 조회 — fetchActive=false → pool.query 1번 호출
    mockPool.query.mockResolvedValueOnce({
      rows: [makeExitedRow({ return_7d: "5.0", return_30d: "10.0", return_90d: "20.0" })],
    });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ status: "EXITED" }),
    );

    expect(result.recentClosed[0].return7d).toBeCloseTo(5.0);
    expect(result.recentClosed[0].return30d).toBeCloseTo(10.0);
    expect(result.recentClosed[0].return90d).toBeCloseTo(20.0);
  });

  it("closed 아이템에 source, tier가 포함된다", async () => {
    // EXITED만 조회 → pool.query 1번 호출
    mockPool.query.mockResolvedValueOnce({
      rows: [makeExitedRow({ source: "thesis_aligned", tier: "featured" })],
    });

    const result = JSON.parse(
      await readTrackedStocksPerformance.execute({ status: "EXITED" }),
    );

    expect(result.recentClosed[0].source).toBe("thesis_aligned");
    expect(result.recentClosed[0].tier).toBe("featured");
  });
});

// ─── tool definition 테스트 ───────────────────────────────────────────────────

describe("readTrackedStocksPerformance.definition", () => {
  it("status enum에 EXPIRED가 포함된다 (기존 CLOSED 대신)", () => {
    const schema = readTrackedStocksPerformance.definition.input_schema as Record<
      string,
      unknown
    >;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const statusEnum = properties.status.enum as string[];
    expect(statusEnum).toContain("EXPIRED");
    expect(statusEnum).toContain("EXITED");
    expect(statusEnum).toContain("ACTIVE");
    expect(statusEnum).not.toContain("CLOSED");
  });

  it("period enum에 this_week이 포함된다", () => {
    const schema = readTrackedStocksPerformance.definition.input_schema as Record<
      string,
      unknown
    >;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const periodEnum = properties.period.enum as string[];
    expect(periodEnum).toContain("this_week");
    expect(periodEnum).toContain("all");
  });

  it("source 필터 enum이 올바른 값을 포함한다", () => {
    const schema = readTrackedStocksPerformance.definition.input_schema as Record<
      string,
      unknown
    >;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const sourceEnum = properties.source.enum as string[];
    expect(sourceEnum).toContain("etl_auto");
    expect(sourceEnum).toContain("agent");
    expect(sourceEnum).toContain("thesis_aligned");
  });
});
