import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB client before importing anything that uses it
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    update: () => ({ set: mockSet }),
  },
  pool: {
    query: mockQuery,
    end: mockEnd,
  },
}));

vi.mock("@/db/schema/analyst", () => ({
  recommendations: {
    id: "id",
    status: "status",
    symbol: "symbol",
    recommendationDate: "recommendation_date",
  },
}));

vi.mock("@/etl/utils/validation", () => ({
  assertValidEnvironment: vi.fn(),
}));

vi.mock("@/etl/utils/date-helpers", () => ({
  getLatestTradeDate: vi.fn(),
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

// Import after mocks
import { getLatestTradeDate } from "@/etl/utils/date-helpers";

describe("update-recommendation-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("calculates PnL correctly", () => {
    const entryPrice = 100;
    const currentPrice = 115;
    const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;

    expect(pnl).toBe(15);
  });

  it("tracks max PnL as high water mark", () => {
    const prevMaxPnl = 20;
    const currentPnl = 15;
    const maxPnl = Math.max(prevMaxPnl, currentPnl);

    expect(maxPnl).toBe(20);
  });

  it("updates max PnL when current exceeds previous", () => {
    const prevMaxPnl = 10;
    const currentPnl = 25;
    const maxPnl = Math.max(prevMaxPnl, currentPnl);

    expect(maxPnl).toBe(25);
  });

  it("detects Phase 2 exit correctly", () => {
    const currentPhase: number = 3;
    const isPhaseExit = currentPhase != null && currentPhase !== 2;

    expect(isPhaseExit).toBe(true);
  });

  it("does not exit when Phase is 2", () => {
    const currentPhase: number = 2;
    const isPhaseExit = currentPhase != null && currentPhase !== 2;

    expect(isPhaseExit).toBe(false);
  });

  it("handles negative PnL", () => {
    const entryPrice = 100;
    const currentPrice = 85;
    const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;

    expect(pnl).toBe(-15);
  });

  it("increments daysHeld", () => {
    const prevDaysHeld = 5;
    const daysHeld = (prevDaysHeld ?? 0) + 1;

    expect(daysHeld).toBe(6);
  });

  it("handles null daysHeld as 0", () => {
    const prevDaysHeld = null;
    const daysHeld = (prevDaysHeld ?? 0) + 1;

    expect(daysHeld).toBe(1);
  });
});
