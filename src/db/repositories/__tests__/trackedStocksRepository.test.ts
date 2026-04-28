/**
 * trackedStocksRepository 단위 테스트.
 *
 * 검증 대상:
 * - findActiveTrackedStocks: ACTIVE 상태 전체 조회 SQL
 * - findActiveTrackedStocksBySymbols: 빈 배열 early return, SQL 파라미터
 * - findTrackedStockById: 단건 조회 — 존재 시 row, 미존재 시 null
 * - findRecentTrackedBySymbol: 쿨다운 체크용 SQL
 * - findActiveTrackedStocksBySource: source 필터 SQL
 * - findActiveTrackedStocksByTier: tier 필터 SQL
 * - insertTrackedStock: INSERT 쿼리 파라미터 순서
 * - updateTracking: COALESCE 기반 return 필드 immutable 갱신 SQL
 * - exitTrackedStock: EXITED 전환 SQL
 * - expireTrackedStock: EXPIRED 전환 SQL
 * - updateTrackedStockTier: tier 변경 SQL
 *
 * DB는 mock 처리. 실제 Supabase 연결 없음.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "@/db/client";
import {
  findActiveTrackedStocks,
  findActiveTrackedStocksBySymbols,
  findTrackedStockById,
  findRecentTrackedBySymbol,
  findActiveTrackedStocksBySource,
  findActiveTrackedStocksByTier,
  insertTrackedStock,
  updateTracking,
  exitTrackedStock,
  expireTrackedStock,
  updateTrackedStockTier,
  type InsertTrackedStockInput,
  type TrackedStockTrackingUpdate,
} from "../trackedStocksRepository.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function getLastCallSql(): string {
  const calls = mockQuery.mock.calls;
  if (calls.length === 0) throw new Error("pool.query not called");
  return calls[calls.length - 1][0] as string;
}

function getLastCallParams(): unknown[] {
  const calls = mockQuery.mock.calls;
  if (calls.length === 0) throw new Error("pool.query not called");
  return (calls[calls.length - 1][1] as unknown[]) ?? [];
}

function makeInsertInput(overrides: Partial<InsertTrackedStockInput> = {}): InsertTrackedStockInput {
  return {
    symbol: "NVDA",
    source: "etl_auto",
    tier: "standard",
    entryDate: "2026-04-14",
    entryPrice: 850.5,
    entryPhase: 2,
    entryPrevPhase: 1,
    entryRsScore: 88,
    entrySepaGrade: "A",
    entryThesisId: null,
    entrySector: "Technology",
    entryIndustry: "Semiconductors",
    entryReason: "AI 수요 가속, Phase 2 진입",
    phase2Since: "2026-04-10",
    marketRegime: "EARLY_BULL",
    trackingEndDate: "2026-07-13",
    ...overrides,
  };
}

function makeTrackingUpdate(overrides: Partial<TrackedStockTrackingUpdate> = {}): TrackedStockTrackingUpdate {
  return {
    id: 1,
    currentPhase: 2,
    currentRsScore: 90,
    currentPrice: 900.0,
    pnlPercent: 5.8,
    maxPnlPercent: 5.8,
    daysTracked: 3,
    lastUpdated: "2026-04-17",
    phaseTrajectory: [
      { date: "2026-04-14", phase: 2, rsScore: 88 },
      { date: "2026-04-15", phase: 2, rsScore: 89 },
      { date: "2026-04-17", phase: 2, rsScore: 90 },
    ],
    sectorRelativePerf: 1.2,
    return7d: null,
    return30d: null,
    return90d: null,
    ...overrides,
  };
}

// ─── findActiveTrackedStocks ───────────────────────────────────────────────────

describe("findActiveTrackedStocks", () => {
  it("ACTIVE 상태 전체를 조회하는 SQL을 실행한다", async () => {
    await findActiveTrackedStocks();

    const sql = getLastCallSql();
    expect(sql).toContain("FROM tracked_stocks");
    expect(sql).toContain("status = 'ACTIVE'");
    expect(sql).toContain("ORDER BY entry_date DESC");
  });

  it("빈 결과를 빈 배열로 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const result = await findActiveTrackedStocks();
    expect(result).toEqual([]);
  });

  it("여러 행을 반환할 때 모두 포함한다", async () => {
    const fakeRows = [
      { id: 1, symbol: "NVDA", status: "ACTIVE" },
      { id: 2, symbol: "TSM", status: "ACTIVE" },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows, rowCount: 2 } as never);

    const result = await findActiveTrackedStocks();
    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe("NVDA");
    expect(result[1].symbol).toBe("TSM");
  });
});

// ─── findActiveTrackedStocksBySymbols ──────────────────────────────────────────

describe("findActiveTrackedStocksBySymbols", () => {
  it("빈 배열 입력 시 DB를 조회하지 않고 빈 배열을 반환한다", async () => {
    const result = await findActiveTrackedStocksBySymbols([]);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("symbols를 파라미터로 전달하는 SQL을 실행한다", async () => {
    await findActiveTrackedStocksBySymbols(["NVDA", "TSM"]);

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("status = 'ACTIVE'");
    expect(sql).toContain("ANY($1)");
    expect(params[0]).toEqual(["NVDA", "TSM"]);
  });
});

// ─── findTrackedStockById ─────────────────────────────────────────────────────

describe("findTrackedStockById", () => {
  it("id를 파라미터로 전달하는 SQL을 실행한다", async () => {
    await findTrackedStockById(42);

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("WHERE id = $1");
    expect(params[0]).toBe(42);
  });

  it("행이 존재하면 해당 행을 반환한다", async () => {
    const fakeRow = { id: 42, symbol: "NVDA", status: "ACTIVE" };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 } as never);

    const result = await findTrackedStockById(42);
    expect(result).toEqual(fakeRow);
  });

  it("행이 없으면 null을 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await findTrackedStockById(999);
    expect(result).toBeNull();
  });
});

// ─── findRecentTrackedBySymbol ────────────────────────────────────────────────

describe("findRecentTrackedBySymbol", () => {
  it("symbol과 days를 파라미터로 전달하는 SQL을 실행한다", async () => {
    await findRecentTrackedBySymbol("NVDA", 30);

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("symbol = $1");
    expect(sql).toContain("status <> 'ACTIVE'");
    expect(sql).toContain("$2::integer * INTERVAL '1 day'");
    expect(params[0]).toBe("NVDA");
    expect(params[1]).toBe(30);
  });

  it("쿨다운 기간 내에 EXITED/EXPIRED 이력이 있으면 반환한다", async () => {
    const fakeRows = [{ id: 5, symbol: "NVDA", entry_date: "2026-03-20" }];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows, rowCount: 1 } as never);

    const result = await findRecentTrackedBySymbol("NVDA", 30);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("NVDA");
  });
});

// ─── findActiveTrackedStocksBySource ──────────────────────────────────────────

describe("findActiveTrackedStocksBySource", () => {
  it("source를 파라미터로 전달하는 SQL을 실행한다", async () => {
    await findActiveTrackedStocksBySource("etl_auto");

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("status = 'ACTIVE'");
    expect(sql).toContain("source = $1");
    expect(params[0]).toBe("etl_auto");
  });

  it("thesis_aligned source 조회도 동일한 패턴을 사용한다", async () => {
    await findActiveTrackedStocksBySource("thesis_aligned");

    const params = getLastCallParams();
    expect(params[0]).toBe("thesis_aligned");
  });
});

// ─── findActiveTrackedStocksByTier ────────────────────────────────────────────

describe("findActiveTrackedStocksByTier", () => {
  it("tier를 파라미터로 전달하는 SQL을 실행한다", async () => {
    await findActiveTrackedStocksByTier("featured");

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("status = 'ACTIVE'");
    expect(sql).toContain("tier = $1");
    expect(params[0]).toBe("featured");
  });
});

// ─── insertTrackedStock ───────────────────────────────────────────────────────

describe("insertTrackedStock", () => {
  it("INSERT SQL에 ON CONFLICT DO NOTHING이 포함된다", async () => {
    await insertTrackedStock(makeInsertInput());

    const sql = getLastCallSql();
    expect(sql).toContain("INSERT INTO tracked_stocks");
    expect(sql).toContain("phase2_since");
    expect(sql).toContain("ON CONFLICT (symbol, entry_date) DO NOTHING");
    expect(sql).toContain("RETURNING id");
  });

  it("입력 데이터가 올바른 순서로 파라미터에 전달된다", async () => {
    const input = makeInsertInput();
    await insertTrackedStock(input);

    const params = getLastCallParams();
    expect(params[0]).toBe(input.symbol);
    expect(params[1]).toBe(input.source);
    expect(params[2]).toBe(input.tier);
    expect(params[3]).toBe(input.entryDate);
    expect(params[4]).toBe(input.entryPrice);
    expect(params[5]).toBe(input.entryPhase);
  });

  it("중복(충돌) 시 null을 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const result = await insertTrackedStock(makeInsertInput());
    expect(result).toBeNull();
  });

  it("삽입 성공 시 id를 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 } as never);
    const result = await insertTrackedStock(makeInsertInput());
    expect(result).toBe(99);
  });

  it("thesis_aligned 소스로 등록할 수 있다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 } as never);
    const input = makeInsertInput({
      source: "thesis_aligned",
      tier: "featured",
      entryThesisId: 7,
    });
    const result = await insertTrackedStock(input);

    const params = getLastCallParams();
    expect(params[1]).toBe("thesis_aligned");
    expect(params[2]).toBe("featured");
    expect(params[9]).toBe(7); // entryThesisId
    expect(result).toBe(10);
  });

  it("INSERT SQL에 current_phase, current_price, current_rs_score 컬럼이 포함된다", async () => {
    await insertTrackedStock(makeInsertInput());

    const sql = getLastCallSql();
    expect(sql).toContain("current_phase");
    expect(sql).toContain("current_price");
    expect(sql).toContain("current_rs_score");
  });

  it("currentPhase, currentPrice, currentRsScore를 전달하면 파라미터에 포함된다", async () => {
    const input = makeInsertInput({
      currentPhase: 2,
      currentPrice: 850.5,
      currentRsScore: 88,
    });
    await insertTrackedStock(input);

    const params = getLastCallParams();
    // current_* 필드는 $17, $18, $19 (마지막 3개 파라미터)
    expect(params[16]).toBe(2);     // currentPhase
    expect(params[17]).toBe(850.5); // currentPrice
    expect(params[18]).toBe(88);    // currentRsScore
  });

  it("currentPhase 등 미지정 시 null로 전달된다 (하위 호환)", async () => {
    const input = makeInsertInput(); // current_* 미설정
    await insertTrackedStock(input);

    const params = getLastCallParams();
    expect(params[16]).toBeNull(); // currentPhase
    expect(params[17]).toBeNull(); // currentPrice
    expect(params[18]).toBeNull(); // currentRsScore
  });
});

// ─── updateTracking ───────────────────────────────────────────────────────────

describe("updateTracking", () => {
  it("UPDATE SQL에 올바른 컬럼들이 포함된다", async () => {
    await updateTracking(makeTrackingUpdate());

    const sql = getLastCallSql();
    expect(sql).toContain("UPDATE tracked_stocks");
    expect(sql).toContain("current_phase");
    expect(sql).toContain("current_rs_score");
    expect(sql).toContain("current_price");
    expect(sql).toContain("pnl_percent");
    expect(sql).toContain("max_pnl_percent");
    expect(sql).toContain("days_tracked");
    expect(sql).toContain("last_updated");
    expect(sql).toContain("phase_trajectory");
  });

  it("return 필드에 COALESCE를 사용하여 한번 계산된 값을 보존한다", async () => {
    await updateTracking(makeTrackingUpdate());

    const sql = getLastCallSql();
    expect(sql).toContain("COALESCE(return_7d");
    expect(sql).toContain("COALESCE(return_30d");
    expect(sql).toContain("COALESCE(return_90d");
  });

  it("phaseTrajectory를 JSON 문자열로 직렬화하여 전달한다", async () => {
    const trajectory = [
      { date: "2026-04-14", phase: 2, rsScore: 88 },
      { date: "2026-04-15", phase: 2, rsScore: 90 },
    ];
    await updateTracking(makeTrackingUpdate({ phaseTrajectory: trajectory }));

    const params = getLastCallParams();
    // phaseTrajectory는 JSON.stringify된 문자열로 전달된다
    const trajectoryParam = params.find(
      (p) => typeof p === "string" && p.includes('"date"')
    );
    expect(trajectoryParam).toBeDefined();
    expect(JSON.parse(trajectoryParam as string)).toEqual(trajectory);
  });

  it("id를 마지막 파라미터로 전달한다", async () => {
    const update = makeTrackingUpdate({ id: 42 });
    await updateTracking(update);

    const params = getLastCallParams();
    expect(params[params.length - 1]).toBe(42);
  });
});

// ─── exitTrackedStock ─────────────────────────────────────────────────────────

describe("exitTrackedStock", () => {
  it("EXITED 상태로 전환하는 SQL을 실행한다", async () => {
    await exitTrackedStock(1, "2026-04-17", "agent_decision");

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("status = 'EXITED'");
    expect(sql).toContain("exit_date");
    expect(sql).toContain("exit_reason");
    expect(params[0]).toBe("2026-04-17");
    expect(params[1]).toBe("agent_decision");
  });

  it("exitPrice, pnlPercent, maxPnlPercent를 포함하여 업데이트한다", async () => {
    await exitTrackedStock(1, "2026-04-17", "trailing_stop", 150, 12.5, 18.3);

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("current_price");
    expect(sql).toContain("pnl_percent");
    expect(sql).toContain("max_pnl_percent");
    expect(params).toContain(150);
    expect(params).toContain(12.5);
    expect(params).toContain(18.3);
  });
});

// ─── expireTrackedStock ───────────────────────────────────────────────────────

describe("expireTrackedStock", () => {
  it("EXPIRED 상태로 전환하는 SQL을 실행한다", async () => {
    await expireTrackedStock(5, "2026-07-13");

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("status = 'EXPIRED'");
    expect(sql).toContain("tracking_window_expired");
    expect(params[0]).toBe("2026-07-13");
    expect(params[1]).toBe(5);
  });
});

// ─── updateTrackedStockTier ───────────────────────────────────────────────────

describe("updateTrackedStockTier", () => {
  it("tier를 featured로 승격하는 SQL을 실행한다", async () => {
    await updateTrackedStockTier(3, "featured");

    const sql = getLastCallSql();
    const params = getLastCallParams();
    expect(sql).toContain("UPDATE tracked_stocks");
    expect(sql).toContain("tier = $1");
    expect(params[0]).toBe("featured");
    expect(params[1]).toBe(3);
  });

  it("tier를 standard로 강등하는 SQL을 실행한다", async () => {
    await updateTrackedStockTier(3, "standard");

    const params = getLastCallParams();
    expect(params[0]).toBe("standard");
  });
});
