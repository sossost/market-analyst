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
    vi.resetAllMocks();
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

  it("includes closedByReason breakdown in summary", async () => {
    const phaseExit = makeRec({
      status: "CLOSED_PHASE_EXIT",
      pnlPercent: "10",
      closeDate: "2026-03-04",
      closePrice: "110",
    });
    const trailingStop = makeRec({
      id: 2,
      symbol: "MSFT",
      status: "CLOSED_TRAILING_STOP",
      pnlPercent: "15",
      closeDate: "2026-03-05",
      closePrice: "115",
    });

    mockLimit.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([phaseExit, trailingStop]);

    const result = await readRecommendationPerformance.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.summary.closedByReason.phaseExit).toBe(1);
    expect(parsed.summary.closedByReason.trailingStop).toBe(1);
    expect(parsed.summary.closedByReason.other).toBe(0);
  });

  it("closedByReason.other counts non-standard close reasons", async () => {
    const unknown = makeRec({
      status: "CLOSED_MANUAL",
      pnlPercent: "5",
      closeDate: "2026-03-04",
      closePrice: "105",
    });

    mockLimit.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([unknown]);

    const result = await readRecommendationPerformance.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.summary.closedByReason.phaseExit).toBe(0);
    expect(parsed.summary.closedByReason.trailingStop).toBe(0);
    expect(parsed.summary.closedByReason.other).toBe(1);
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
    // status=CLOSED이면 active 쿼리를 스킵하므로 closed 결과만 설정
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

  describe("period: this_week", () => {
    /**
     * this_week 모드는 .limit()을 사용하지 않으므로
     * mockOrderBy가 직접 Promise로 resolve되어야 한다.
     */
    function setupWeeklyMocks(
      newRecs: ReturnType<typeof makeRec>[] = [],
      closedRecs: ReturnType<typeof makeRec>[] = [],
      phaseExitRecs: ReturnType<typeof makeRec>[] = [],
    ) {
      // this_week 모드: 3개 쿼리 모두 from → where → orderBy (limit 없음)
      // phaseExits 쿼리는 orderBy 없이 from → where만 사용
      let callCount = 0;
      mockOrderBy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(newRecs);
        return Promise.resolve(closedRecs);
      });
      // phaseExits 쿼리는 where에서 바로 resolve (orderBy 없음)
      let whereCallCount = 0;
      mockWhere.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 3) {
          // 3번째 where 호출 = phaseExits (orderBy 없이 직접 resolve)
          return Promise.resolve(phaseExitRecs);
        }
        return { orderBy: mockOrderBy };
      });
    }

    it("period 미지정 시 기존 동작 동일", async () => {
      mockLimit.mockResolvedValue([]);

      const result = await readRecommendationPerformance.execute({});
      const parsed = JSON.parse(result);

      expect(parsed.summary).toBeDefined();
      expect(parsed.active).toBeDefined();
      expect(parsed.recentClosed).toBeDefined();
      expect(parsed.period).toBeUndefined();
    });

    it("period: this_week 시 주간 집계 반환", async () => {
      const newRec = makeRec({
        recommendationDate: "2026-03-06",
        symbol: "NVDA",
      });
      setupWeeklyMocks([newRec], [], []);

      const result = await readRecommendationPerformance.execute({
        period: "this_week",
      });
      const parsed = JSON.parse(result);

      expect(parsed.period).toBe("this_week");
      expect(parsed.weekStart).toBeDefined();
      expect(parsed.weeklySummary).toBeDefined();
      expect(parsed.weeklySummary.newCount).toBe(1);
      expect(parsed.weeklySummary.closedCount).toBe(0);
      expect(parsed.newThisWeek).toHaveLength(1);
      expect(parsed.newThisWeek[0].symbol).toBe("NVDA");
      expect(parsed.closedThisWeek).toEqual([]);
    });

    it("주간 승률 계산 정확성 (이번 주 종료 건 기준)", async () => {
      const winner = makeRec({
        symbol: "AAPL",
        status: "CLOSED_PHASE_EXIT",
        pnlPercent: "12",
        closeDate: "2026-03-06",
        closeReason: "phase_exit",
      });
      const loser = makeRec({
        symbol: "MSFT",
        status: "CLOSED_PHASE_EXIT",
        pnlPercent: "-5",
        closeDate: "2026-03-07",
        closeReason: "phase_exit",
      });
      const winner2 = makeRec({
        symbol: "GOOG",
        status: "CLOSED_PHASE_EXIT",
        pnlPercent: "8",
        closeDate: "2026-03-07",
        closeReason: "phase_exit",
      });
      setupWeeklyMocks([], [winner, loser, winner2], []);

      const result = await readRecommendationPerformance.execute({
        period: "this_week",
      });
      const parsed = JSON.parse(result);

      expect(parsed.weeklySummary.closedCount).toBe(3);
      // 2 winners / 3 total = 66.67% → 67%
      expect(parsed.weeklySummary.weekWinRate).toBe(67);
      // avg: (12 + -5 + 8) / 3 = 5
      expect(parsed.weeklySummary.weekAvgPnl).toBe(5);
    });

    it("phaseExits에 Phase 변경 종목만 포함", async () => {
      const phaseChanged = makeRec({
        symbol: "TSLA",
        status: "ACTIVE",
        entryPhase: 2,
        currentPhase: 3,
        pnlPercent: "20",
        daysHeld: 14,
      });
      setupWeeklyMocks([], [], [phaseChanged]);

      const result = await readRecommendationPerformance.execute({
        period: "this_week",
      });
      const parsed = JSON.parse(result);

      expect(parsed.phaseExits).toHaveLength(1);
      expect(parsed.phaseExits[0].symbol).toBe("TSLA");
      expect(parsed.phaseExits[0].entryPhase).toBe(2);
      expect(parsed.phaseExits[0].currentPhase).toBe(3);
      expect(parsed.phaseExits[0].pnlPercent).toBe(20);
      expect(parsed.phaseExits[0].daysHeld).toBe(14);
    });

    it("이번 주 데이터 없을 때 빈 배열 반환", async () => {
      setupWeeklyMocks([], [], []);

      const result = await readRecommendationPerformance.execute({
        period: "this_week",
      });
      const parsed = JSON.parse(result);

      expect(parsed.weeklySummary.newCount).toBe(0);
      expect(parsed.weeklySummary.closedCount).toBe(0);
      expect(parsed.weeklySummary.weekWinRate).toBe(0);
      expect(parsed.weeklySummary.weekAvgPnl).toBe(0);
      expect(parsed.newThisWeek).toEqual([]);
      expect(parsed.closedThisWeek).toEqual([]);
      expect(parsed.phaseExits).toEqual([]);
    });

    it("this_week 모드에서 closedByReason 구분 포함", async () => {
      const phaseExit = makeRec({
        symbol: "AAPL",
        status: "CLOSED_PHASE_EXIT",
        pnlPercent: "10",
        closeDate: "2026-03-06",
      });
      const trailingStop = makeRec({
        symbol: "NVDA",
        id: 2,
        status: "CLOSED_TRAILING_STOP",
        pnlPercent: "18",
        closeDate: "2026-03-07",
      });
      setupWeeklyMocks([], [phaseExit, trailingStop], []);

      const result = await readRecommendationPerformance.execute({
        period: "this_week",
      });
      const parsed = JSON.parse(result);

      expect(parsed.weeklySummary.closedByReason).toBeDefined();
      expect(parsed.weeklySummary.closedByReason.phaseExit).toBe(1);
      expect(parsed.weeklySummary.closedByReason.trailingStop).toBe(1);
      expect(parsed.weeklySummary.closedByReason.other).toBe(0);
    });
  });
});
