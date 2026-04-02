import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  pool: {
    query: mockQuery,
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

import { getMarketBreadth } from "@/tools/getMarketBreadth";

// --- helpers ---

/** Phase 분포 쿼리 응답 */
const makePhaseRows = (counts: Record<number, number>) => ({
  rows: Object.entries(counts).map(([phase, count]) => ({
    phase: Number(phase),
    count: String(count),
  })),
});

/** 전일 Phase 2 비율 쿼리 응답 */
const makePrevPhase2Row = (phase2: number, total: number) => ({
  rows: [{ phase2_count: String(phase2), total_count: String(total) }],
});

/** 시장 평균 RS 쿼리 응답 */
const makeRsRow = (avg: number) => ({
  rows: [{ avg_rs: String(avg) }],
});

/** A/D 쿼리 응답 */
const makeAdRow = (adv: number, dec: number, unch: number) => ({
  rows: [
    {
      advancers: String(adv),
      decliners: String(dec),
      unchanged: String(unch),
    },
  ],
});

/** 52주 신고가/신저가 응답 */
const makeHlRow = (highs: number, lows: number) => ({
  rows: [{ new_highs: String(highs), new_lows: String(lows) }],
});

/** 상위 섹터 응답 */
const makeSectorRows = (
  sectors: Array<{ sector: string; avg_rs: number; group_phase: number }>,
) => ({
  rows: sectors.map((s) => ({
    sector: s.sector,
    avg_rs: String(s.avg_rs),
    group_phase: s.group_phase,
  })),
});

/** daily 모드에서 필요한 6개 쿼리를 순서대로 모킹 */
function setupDailyMocks(overrides?: {
  phaseCounts?: Record<number, number>;
  prevPhase2?: number;
  prevTotal?: number;
  avgRs?: number;
  adv?: number;
  dec?: number;
  unch?: number;
  highs?: number;
  lows?: number;
  sectors?: Array<{ sector: string; avg_rs: number; group_phase: number }>;
}) {
  const o = {
    phaseCounts: { 1: 200, 2: 100, 3: 50, 4: 150 },
    prevPhase2: 90,
    prevTotal: 500,
    avgRs: 50.0,
    adv: 250,
    dec: 200,
    unch: 50,
    highs: 30,
    lows: 10,
    sectors: [
      { sector: "Technology", avg_rs: 72.5, group_phase: 2 },
      { sector: "Healthcare", avg_rs: 65.0, group_phase: 2 },
    ],
    ...overrides,
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // findMarketBreadthSnapshot → null → 폴백
    .mockResolvedValueOnce(makePhaseRows(o.phaseCounts)) // Phase 분포
    .mockResolvedValueOnce(makePrevPhase2Row(o.prevPhase2, o.prevTotal)) // 전일 Phase2
    .mockResolvedValueOnce(makeRsRow(o.avgRs)) // 평균 RS
    .mockResolvedValueOnce(makeAdRow(o.adv, o.dec, o.unch)) // A/D
    .mockResolvedValueOnce(makeHlRow(o.highs, o.lows)) // 신고가/신저가
    .mockResolvedValueOnce(makeSectorRows(o.sectors)); // 섹터
}

/** weekly 5거래일 날짜 응답 (DESC 순서 — DB가 반환하는 순서) */
const makeWeeklyDateRows = (dates: string[]) => ({
  rows: [...dates].reverse().map((d) => ({ date: d })),
});

/** weekly trend 쿼리 응답 */
const makeWeeklyTrendRows = (
  items: Array<{ date: string; total: number; phase2: number; avgRs: number }>,
) => ({
  rows: items.map((i) => ({
    date: i.date,
    total: String(i.total),
    phase2_count: String(i.phase2),
    avg_rs: String(i.avgRs),
  })),
});

/** weekly phase1→2 전환 응답 */
const makeTransitionRow = (count: number) => ({
  rows: [{ transitions: String(count) }],
});

/**
 * weekly 모드에서 필요한 8개 쿼리를 순서대로 모킹:
 * 1) 5거래일 날짜
 * 2) trend (phase2/rs per date)
 * 3) phase1→2 전환
 * 4) phase 분포 (latest)
 * 5) A/D (latest)
 * 6) 52주 신고가/신저가 (latest)
 * 7) 상위 섹터 (latest)
 */
function setupWeeklyMocks(overrides?: {
  dates?: string[];
  trend?: Array<{
    date: string;
    total: number;
    phase2: number;
    avgRs: number;
  }>;
  transitions?: number;
  phaseCounts?: Record<number, number>;
  adv?: number;
  dec?: number;
  unch?: number;
  highs?: number;
  lows?: number;
  sectors?: Array<{ sector: string; avg_rs: number; group_phase: number }>;
}) {
  const dates = overrides?.dates ?? [
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
  ];
  const trend = overrides?.trend ?? [
    { date: "2026-03-02", total: 500, phase2: 80, avgRs: 48.0 },
    { date: "2026-03-03", total: 500, phase2: 85, avgRs: 49.0 },
    { date: "2026-03-04", total: 500, phase2: 90, avgRs: 50.0 },
    { date: "2026-03-05", total: 500, phase2: 95, avgRs: 51.0 },
    { date: "2026-03-06", total: 500, phase2: 100, avgRs: 52.0 },
  ];

  const o = {
    transitions: 12,
    phaseCounts: { 1: 200, 2: 100, 3: 50, 4: 150 },
    adv: 250,
    dec: 200,
    unch: 50,
    highs: 30,
    lows: 10,
    sectors: [
      { sector: "Technology", avg_rs: 72.5, group_phase: 2 },
    ],
    ...overrides,
  };

  mockQuery
    .mockResolvedValueOnce(makeWeeklyDateRows(dates)) // 1) 날짜 목록
    .mockResolvedValueOnce({ rows: [] }) // 2) findMarketBreadthSnapshots → 빈배열 → 폴백
    .mockResolvedValueOnce(makeWeeklyTrendRows(trend)) // 3) trend (폴백)
    .mockResolvedValueOnce(makeTransitionRow(o.transitions)) // 4) 전환 (폴백)
    .mockResolvedValueOnce(makePhaseRows(o.phaseCounts)) // 5) phase 분포 (폴백)
    .mockResolvedValueOnce(makeAdRow(o.adv, o.dec, o.unch)) // 6) A/D (폴백)
    .mockResolvedValueOnce(makeHlRow(o.highs, o.lows)) // 7) 신고가/신저가 (폴백)
    .mockResolvedValueOnce(makeSectorRows(o.sectors)); // 8) 섹터
}

// --- tests ---

describe("getMarketBreadth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool definition", () => {
    expect(getMarketBreadth.definition.name).toBe("get_market_breadth");
    expect(getMarketBreadth.definition.input_schema.properties).toHaveProperty(
      "mode",
    );
  });

  it("rejects invalid date", async () => {
    const result = await getMarketBreadth.execute({ date: "not-a-date" });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeTruthy();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // --- daily mode ---

  it("mode 미지정 시 기존 daily 동작", async () => {
    setupDailyMocks();

    const result = await getMarketBreadth.execute({ date: "2026-03-06" });
    const parsed = JSON.parse(result);

    // daily는 mode 필드 없이 date 반환
    expect(parsed.date).toBe("2026-03-06");
    expect(parsed.mode).toBeUndefined();
    expect(parsed.totalStocks).toBe(500);
    expect(parsed.phaseDistribution).toEqual({
      phase1: 200,
      phase2: 100,
      phase3: 50,
      phase4: 150,
    });
    // phase2Ratio = 100/500 * 100 = 20.0
    expect(parsed.phase2Ratio).toBe(20.0);
    // prevRatio = 90/500 * 100 = 18.0, change = 2.0
    expect(parsed.phase2RatioChange).toBe(2.0);
    expect(parsed.marketAvgRs).toBe(50.0);
    expect(parsed.advanceDecline.ratio).toBe(1.25);
    expect(parsed.newHighLow.newHighs).toBe(30);
    expect(parsed.topSectors).toHaveLength(2);
  });

  it("mode: 'daily' 명시해도 동일하게 동작", async () => {
    setupDailyMocks();

    const result = await getMarketBreadth.execute({
      date: "2026-03-06",
      mode: "daily",
    });
    const parsed = JSON.parse(result);

    expect(parsed.date).toBe("2026-03-06");
    expect(parsed.mode).toBeUndefined();
    expect(parsed.totalStocks).toBe(500);
  });

  // --- weekly mode ---

  it("mode: 'weekly' 시 5거래일 추이 배열 반환", async () => {
    setupWeeklyMocks();

    const result = await getMarketBreadth.execute({
      date: "2026-03-06",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe("weekly");
    expect(parsed.dates).toHaveLength(5);
    expect(parsed.dates[0]).toBe("2026-03-02");
    expect(parsed.dates[4]).toBe("2026-03-06");
    expect(parsed.weeklyTrend).toHaveLength(5);

    // 각 trend 항목에 필수 필드 존재
    for (const item of parsed.weeklyTrend) {
      expect(item).toHaveProperty("date");
      expect(item).toHaveProperty("phase2Ratio");
      expect(item).toHaveProperty("marketAvgRs");
    }

    // latestSnapshot 존재
    expect(parsed.latestSnapshot).toBeDefined();
    expect(parsed.latestSnapshot.date).toBe("2026-03-06");
    expect(parsed.latestSnapshot.totalStocks).toBe(500);
    expect(parsed.latestSnapshot.advanceDecline).toBeDefined();
    expect(parsed.latestSnapshot.newHighLow).toBeDefined();
    expect(parsed.latestSnapshot.topSectors).toHaveLength(1);
  });

  it("weekly 모드에서 phase2RatioChange가 주초 대비", async () => {
    setupWeeklyMocks();

    const result = await getMarketBreadth.execute({
      date: "2026-03-06",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    // 주초: 80/500 = 16.0%, 주말: 100/500 = 20.0%, 변화 = 4.0
    const firstRatio = (80 / 500) * 100; // 16.0
    const lastRatio = (100 / 500) * 100; // 20.0
    const expectedChange = Number((lastRatio - firstRatio).toFixed(1)); // 4.0

    expect(parsed.latestSnapshot.phase2RatioChange).toBe(expectedChange);
  });

  it("weekly 모드에서 phase1to2Transitions 합계 확인", async () => {
    setupWeeklyMocks({ transitions: 15 });

    const result = await getMarketBreadth.execute({
      date: "2026-03-06",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    expect(parsed.phase1to2Transitions).toBe(15);
  });

  it("날짜가 5개 미만일 때도 정상 동작 (초기 데이터)", async () => {
    const dates = ["2026-03-05", "2026-03-06"];
    const trend = [
      { date: "2026-03-05", total: 300, phase2: 60, avgRs: 45.0 },
      { date: "2026-03-06", total: 300, phase2: 75, avgRs: 47.0 },
    ];

    setupWeeklyMocks({ dates, trend });

    const result = await getMarketBreadth.execute({
      date: "2026-03-06",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe("weekly");
    expect(parsed.dates).toHaveLength(2);
    expect(parsed.weeklyTrend).toHaveLength(2);

    // 주초 대비 변화: 75/300 - 60/300 = 25.0 - 20.0 = 5.0
    expect(parsed.latestSnapshot.phase2RatioChange).toBe(5.0);
  });

  it("weekly 모드에서 데이터 없으면 에러 반환", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 날짜 없음

    const result = await getMarketBreadth.execute({
      date: "2020-01-01",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeTruthy();
  });
});
