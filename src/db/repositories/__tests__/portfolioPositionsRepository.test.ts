/**
 * portfolioPositionsRepository 단위 테스트.
 *
 * 검증 대상:
 * - insertPortfolioPosition: 정상 삽입(id 반환), 중복 시 null 반환
 * - getActivePortfolioPositions: ACTIVE 종목만 반환, 빈 결과 처리
 * - getPortfolioPositionBySymbol: 해당 symbol ACTIVE 포지션 반환, 없으면 null
 * - updatePortfolioExit: ACTIVE → EXITED 전환 성공, ACTIVE 포지션 없을 시 에러
 * - getAllPortfolioPositions: limit 파라미터 반영
 *
 * DB는 mock 처리. 실제 Supabase 연결 없음.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Drizzle db mock (vi.hoisted로 hoisting 문제 회피) ────────────────────────

const mocks = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockReturning }));
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, returning: mockReturning }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  return {
    mockReturning,
    mockOnConflictDoNothing,
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockFrom,
    mockSet,
    mockValues,
    mockSelect,
    mockInsert,
    mockUpdate,
  };
});

vi.mock("@/db/client", () => ({
  db: {
    select: mocks.mockSelect,
    insert: mocks.mockInsert,
    update: mocks.mockUpdate,
  },
}));

import {
  insertPortfolioPosition,
  getActivePortfolioPositions,
  getPortfolioPositionBySymbol,
  updatePortfolioExit,
  getAllPortfolioPositions,
  PortfolioPositionNotFoundError,
  type InsertPortfolioPositionInput,
  type PortfolioPositionRow,
} from "../portfolioPositionsRepository.js";

const {
  mockReturning,
  mockOnConflictDoNothing,
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockFrom,
  mockSet,
  mockValues,
  mockSelect,
  mockInsert,
  mockUpdate,
} = mocks;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeInsertInput(
  overrides: Partial<InsertPortfolioPositionInput> = {},
): InsertPortfolioPositionInput {
  return {
    symbol: "NVDA",
    sector: "Technology",
    industry: "Semiconductors",
    entryDate: "2026-04-18",
    entryPrice: 850.5,
    entryPhase: 2,
    entryRsScore: 88,
    entrySepaGrade: "A",
    thesisId: 3,
    tier: "featured",
    ...overrides,
  };
}

function makePositionRow(
  overrides: Partial<PortfolioPositionRow> = {},
): PortfolioPositionRow {
  return {
    id: 1,
    symbol: "NVDA",
    sector: "Technology",
    industry: "Semiconductors",
    entryDate: "2026-04-18",
    entryPrice: "850.5000",
    entryPhase: 2,
    entryRsScore: "88.00",
    entrySepaGrade: "A",
    thesisId: 3,
    exitDate: null,
    exitPrice: null,
    exitReason: null,
    status: "ACTIVE",
    tier: "featured",
    createdAt: new Date("2026-04-18T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // 기본 체이닝 재설정
  mockReturning.mockResolvedValue([]);
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, returning: mockReturning });
  mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
  mockSet.mockReturnValue({ where: mockWhere });
  mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
  mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockInsert.mockReturnValue({ values: mockValues });
  mockUpdate.mockReturnValue({ set: mockSet });
});

// ─── insertPortfolioPosition ──────────────────────────────────────────────────

describe("insertPortfolioPosition", () => {
  it("삽입 성공 시 id를 반환한다", async () => {
    mockReturning.mockResolvedValueOnce([{ id: 42 }]);

    const result = await insertPortfolioPosition(makeInsertInput());

    expect(result).toBe(42);
  });

  it("중복(ON CONFLICT) 시 null을 반환한다", async () => {
    mockReturning.mockResolvedValueOnce([]);

    const result = await insertPortfolioPosition(makeInsertInput());

    expect(result).toBeNull();
  });

  it("db.insert가 호출되고 onConflictDoNothing이 체이닝된다", async () => {
    mockReturning.mockResolvedValueOnce([{ id: 1 }]);

    await insertPortfolioPosition(makeInsertInput());

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();
    expect(mockOnConflictDoNothing).toHaveBeenCalledOnce();
    expect(mockReturning).toHaveBeenCalledOnce();
  });

  it("옵션 필드 없을 때 tier 기본값 'standard', status 'ACTIVE'로 삽입된다", async () => {
    mockReturning.mockResolvedValueOnce([{ id: 5 }]);

    await insertPortfolioPosition({ symbol: "AAPL", entryDate: "2026-04-18" });

    const valuesArg = (mockValues.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(valuesArg.tier).toBe("standard");
    expect(valuesArg.status).toBe("ACTIVE");
    expect(valuesArg.sector).toBeNull();
    expect(valuesArg.industry).toBeNull();
    expect(valuesArg.thesisId).toBeNull();
  });

  it("숫자 필드를 문자열로 변환하여 전달한다", async () => {
    mockReturning.mockResolvedValueOnce([{ id: 1 }]);

    await insertPortfolioPosition(
      makeInsertInput({ entryPrice: 123.45, entryRsScore: 75.5 }),
    );

    const valuesArg = (mockValues.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(valuesArg.entryPrice).toBe("123.45");
    expect(valuesArg.entryRsScore).toBe("75.5");
  });
});

// ─── getActivePortfolioPositions ──────────────────────────────────────────────

describe("getActivePortfolioPositions", () => {
  it("ACTIVE 포지션 목록을 반환한다", async () => {
    const fakeRows = [
      makePositionRow({ id: 1, symbol: "NVDA" }),
      makePositionRow({ id: 2, symbol: "TSM" }),
    ];
    const mockOrderByInner = vi.fn().mockResolvedValue(fakeRows);
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderByInner, returning: mockReturning });

    const result = await getActivePortfolioPositions();

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe("NVDA");
    expect(result[1].symbol).toBe("TSM");
  });

  it("빈 결과를 빈 배열로 반환한다", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([]), returning: mockReturning });

    const result = await getActivePortfolioPositions();

    expect(result).toEqual([]);
  });

  it("db.select → from → where → orderBy 체이닝이 실행된다", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([]), returning: mockReturning });

    await getActivePortfolioPositions();

    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
  });
});

// ─── getPortfolioPositionBySymbol ─────────────────────────────────────────────

describe("getPortfolioPositionBySymbol", () => {
  it("해당 symbol의 ACTIVE 포지션을 반환한다", async () => {
    const fakeRow = makePositionRow({ symbol: "NVDA" });
    const mockLimitInner = vi.fn().mockResolvedValue([fakeRow]);
    const mockOrderByInner = vi.fn().mockReturnValue({ limit: mockLimitInner });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderByInner, returning: mockReturning });

    const result = await getPortfolioPositionBySymbol("NVDA");

    expect(result).toEqual(fakeRow);
    expect(result?.symbol).toBe("NVDA");
  });

  it("ACTIVE 포지션이 없으면 null을 반환한다", async () => {
    const mockLimitInner = vi.fn().mockResolvedValue([]);
    mockWhere.mockReturnValueOnce({
      orderBy: vi.fn().mockReturnValue({ limit: mockLimitInner }),
      returning: mockReturning,
    });

    const result = await getPortfolioPositionBySymbol("UNKNOWN");

    expect(result).toBeNull();
  });

  it("limit(1)이 호출된다", async () => {
    const mockLimitInner = vi.fn().mockResolvedValue([]);
    const mockOrderByInner = vi.fn().mockReturnValue({ limit: mockLimitInner });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderByInner, returning: mockReturning });

    await getPortfolioPositionBySymbol("NVDA");

    expect(mockLimitInner).toHaveBeenCalledWith(1);
  });
});

// ─── updatePortfolioExit ──────────────────────────────────────────────────────

describe("updatePortfolioExit", () => {
  it("ACTIVE 포지션을 EXITED로 전환하고 갱신된 행을 반환한다", async () => {
    const exitedRow = makePositionRow({
      status: "EXITED",
      exitDate: "2026-04-18",
      exitPrice: "900.0000",
      exitReason: "agent_decision",
    });
    mockReturning.mockResolvedValueOnce([exitedRow]);

    const result = await updatePortfolioExit("NVDA", "2026-04-10", {
      exitDate: "2026-04-18",
      exitPrice: 900.0,
      exitReason: "agent_decision",
    });

    expect(result.status).toBe("EXITED");
    expect(result.exitDate).toBe("2026-04-18");
  });

  it("ACTIVE 포지션이 없으면 PortfolioPositionNotFoundError를 던진다", async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(
      updatePortfolioExit("UNKNOWN", "2026-04-10", { exitDate: "2026-04-18" }),
    ).rejects.toThrow(PortfolioPositionNotFoundError);
  });

  it("에러 메시지에 symbol과 entryDate가 포함된다", async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(
      updatePortfolioExit("TSM", "2026-03-01", { exitDate: "2026-04-18" }),
    ).rejects.toThrow("symbol=TSM, entryDate=2026-03-01");
  });

  it("db.update → set → where → returning 체이닝이 실행된다", async () => {
    const updatedRow = makePositionRow({ status: "EXITED", exitDate: "2026-04-18" });
    mockReturning.mockResolvedValueOnce([updatedRow]);

    await updatePortfolioExit("NVDA", "2026-04-10", { exitDate: "2026-04-18" });

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(mockReturning).toHaveBeenCalledOnce();
  });

  it("set에 status='EXITED', exitDate, exitPrice, exitReason이 포함된다", async () => {
    mockReturning.mockResolvedValueOnce([makePositionRow({ status: "EXITED" })]);

    await updatePortfolioExit("NVDA", "2026-04-10", {
      exitDate: "2026-04-18",
      exitPrice: 900,
      exitReason: "test_reason",
    });

    const setArg = (mockSet.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(setArg.status).toBe("EXITED");
    expect(setArg.exitDate).toBe("2026-04-18");
    expect(setArg.exitPrice).toBe("900");
    expect(setArg.exitReason).toBe("test_reason");
  });

  it("exitPrice 미지정 시 null로 설정한다", async () => {
    mockReturning.mockResolvedValueOnce([makePositionRow({ status: "EXITED" })]);

    await updatePortfolioExit("NVDA", "2026-04-10", { exitDate: "2026-04-18" });

    const setArg = (mockSet.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(setArg.exitPrice).toBeNull();
  });
});

// ─── getAllPortfolioPositions ──────────────────────────────────────────────────

describe("getAllPortfolioPositions", () => {
  it("모든 포지션을 반환한다", async () => {
    const fakeRows = [
      makePositionRow({ id: 1, status: "ACTIVE" }),
      makePositionRow({ id: 2, status: "EXITED" }),
    ];
    const mockLimitInner = vi.fn().mockResolvedValue(fakeRows);
    const mockOrderByInner = vi.fn().mockReturnValue({ limit: mockLimitInner });
    mockFrom.mockReturnValueOnce({ where: mockWhere, orderBy: mockOrderByInner });

    const result = await getAllPortfolioPositions();

    expect(result).toHaveLength(2);
  });

  it("limit 파라미터를 전달하면 해당 개수로 제한된다", async () => {
    const mockLimitInner = vi.fn().mockResolvedValue([]);
    const mockOrderByInner = vi.fn().mockReturnValue({ limit: mockLimitInner });
    mockFrom.mockReturnValueOnce({ where: mockWhere, orderBy: mockOrderByInner });

    await getAllPortfolioPositions(50);

    expect(mockLimitInner).toHaveBeenCalledWith(50);
  });

  it("기본 limit은 100이다", async () => {
    const mockLimitInner = vi.fn().mockResolvedValue([]);
    const mockOrderByInner = vi.fn().mockReturnValue({ limit: mockLimitInner });
    mockFrom.mockReturnValueOnce({ where: mockWhere, orderBy: mockOrderByInner });

    await getAllPortfolioPositions();

    expect(mockLimitInner).toHaveBeenCalledWith(100);
  });
});
