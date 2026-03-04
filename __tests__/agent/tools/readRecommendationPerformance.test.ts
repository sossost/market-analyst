import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockWhere, mockOrderBy, mockLimit } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockLimit: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

vi.mock("@/db/schema/analyst", () => ({
  recommendations: {
    status: "status",
    recommendationDate: "recommendation_date",
    closeDate: "close_date",
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

import { readRecommendationPerformance } from "@/agent/tools/readRecommendationPerformance";

function makeRec(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    symbol: "AAPL",
    recommendationDate: "2026-02-28",
    entryPrice: "100",
    entryRsScore: 75,
    entryPhase: 2,
    entryPrevPhase: 1,
    sector: "Technology",
    industry: "Consumer Electronics",
    reason: "Phase 1→2",
    status: "ACTIVE",
    currentPrice: "115",
    currentPhase: 2,
    currentRsScore: 80,
    pnlPercent: "15",
    maxPnlPercent: "18",
    daysHeld: 5,
    lastUpdated: "2026-03-05",
    closeDate: null,
    closePrice: null,
    closeReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("readRecommendationPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  it("has correct tool name", () => {
    expect(readRecommendationPerformance.definition.name).toBe(
      "read_recommendation_performance",
    );
  });

  it("returns empty summary when no recommendations", async () => {
    const result = await readRecommendationPerformance.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.summary.totalCount).toBe(0);
    expect(parsed.summary.activeCount).toBe(0);
    expect(parsed.summary.closedCount).toBe(0);
    expect(parsed.summary.winRate).toBe(0);
    expect(parsed.active).toEqual([]);
    expect(parsed.recentClosed).toEqual([]);
  });

  it("returns active recommendations", async () => {
    const activeRec = makeRec();
    mockLimit.mockResolvedValueOnce([activeRec]);
    mockLimit.mockResolvedValueOnce([]);

    const result = await readRecommendationPerformance.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.summary.activeCount).toBe(1);
    expect(parsed.active).toHaveLength(1);
    expect(parsed.active[0].symbol).toBe("AAPL");
    expect(parsed.active[0].pnlPercent).toBe(15);
  });

  it("calculates win rate from closed recommendations", async () => {
    const winner = makeRec({
      status: "CLOSED_PHASE_EXIT",
      pnlPercent: "10",
      maxPnlPercent: "15",
      closeDate: "2026-03-04",
      closePrice: "110",
      daysHeld: 10,
    });
    const loser = makeRec({
      id: 2,
      symbol: "MSFT",
      status: "CLOSED_PHASE_EXIT",
      pnlPercent: "-5",
      maxPnlPercent: "3",
      closeDate: "2026-03-03",
      closePrice: "95",
      daysHeld: 7,
    });

    mockLimit.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([winner, loser]);

    const result = await readRecommendationPerformance.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.summary.closedCount).toBe(2);
    expect(parsed.summary.winRate).toBe(50);
    expect(parsed.summary.avgPnlPercent).toBe(2.5);
    expect(parsed.summary.avgMaxPnl).toBe(9);
    expect(parsed.summary.avgDaysHeld).toBe(9);
  });

  it("filters to ACTIVE only when status=ACTIVE", async () => {
    const activeRec = makeRec();
    mockLimit.mockResolvedValueOnce([activeRec]);
    mockLimit.mockResolvedValueOnce([]);

    const result = await readRecommendationPerformance.execute({
      status: "ACTIVE",
    });
    const parsed = JSON.parse(result);

    expect(parsed.active).toHaveLength(1);
    expect(parsed.recentClosed).toEqual([]);
  });

  it("filters to CLOSED only when status=CLOSED", async () => {
    const closedRec = makeRec({
      status: "CLOSED_PHASE_EXIT",
      pnlPercent: "10",
      closeDate: "2026-03-04",
      closePrice: "110",
    });
    mockLimit.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([closedRec]);

    const result = await readRecommendationPerformance.execute({
      status: "CLOSED",
    });
    const parsed = JSON.parse(result);

    expect(parsed.active).toEqual([]);
    expect(parsed.recentClosed).toHaveLength(1);
  });

  it("uses default limit of 30", async () => {
    mockLimit.mockResolvedValue([]);

    await readRecommendationPerformance.execute({});

    expect(mockLimit).toHaveBeenCalledWith(30);
  });

  it("accepts custom limit", async () => {
    mockLimit.mockResolvedValue([]);

    await readRecommendationPerformance.execute({ limit: 10 });

    expect(mockLimit).toHaveBeenCalledWith(10);
  });
});
