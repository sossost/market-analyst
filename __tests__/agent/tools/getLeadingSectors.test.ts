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

import { getLeadingSectors } from "@/tools/getLeadingSectors";

const makeSectorRow = (overrides: Record<string, unknown> = {}) => ({
  sector: "Technology",
  avg_rs: "65.5",
  rs_rank: 1,
  stock_count: 50,
  change_4w: "5.2",
  change_8w: "10.1",
  change_12w: "15.3",
  group_phase: 2,
  prev_group_phase: 1,
  phase2_ratio: "0.65",
  ma_ordered_ratio: "0.72",
  phase1to2_count_5d: 3,
  ...overrides,
});

const makeIndustryRow = (overrides: Record<string, unknown> = {}) => ({
  sector: "Technology",
  industry: "Semiconductors",
  avg_rs: "70.0",
  rs_rank: 1,
  group_phase: 2,
  phase2_ratio: "0.80",
  ...overrides,
});

const makeIndustryGlobalRow = (overrides: Record<string, unknown> = {}) => ({
  sector: "Technology",
  industry: "Semiconductors",
  avg_rs: "70.0",
  rs_rank: 1,
  group_phase: 2,
  phase2_ratio: "0.80",
  change_4w: null,
  change_8w: null,
  change_12w: null,
  sector_avg_rs: "43.49",
  sector_rs_rank: 11,
  ...overrides,
});

describe("getLeadingSectors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct tool name", () => {
    expect(getLeadingSectors.definition.name).toBe("get_leading_sectors");
  });

  it("rejects invalid date", async () => {
    const result = await getLeadingSectors.execute({ date: "bad-date" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeTruthy();
  });

  it("mode 미지정 시 daily 동작 + 전일 RS 비교 포함", async () => {
    // 1st: sector query, 2nd: industry query, 3rd: prevDayDate, 4th: prevDay sectors, 5th: drilldown (Phase 전환)
    mockQuery
      .mockResolvedValueOnce({
        rows: [makeSectorRow({ sector: "Technology", rs_rank: 1 })],
      })
      .mockResolvedValueOnce({
        rows: [makeIndustryRow()],
      })
      .mockResolvedValueOnce({
        rows: [{ prev_day_date: "2026-03-06" }],
      })
      .mockResolvedValueOnce({
        rows: [{ sector: "Technology", avg_rs: "60.0", rs_rank: 2 }],
      })
      .mockResolvedValueOnce({ rows: [] }); // findIndustryDrilldown (Phase 1→2 전환)

    const result = await getLeadingSectors.execute({ date: "2026-03-07" });
    const parsed = JSON.parse(result);

    expect(parsed.date).toBe("2026-03-07");
    expect(parsed.prevDayDate).toBe("2026-03-06");
    expect(parsed.sectors).toHaveLength(1);
    expect(parsed.sectors[0].sector).toBe("Technology");
    expect(parsed.sectors[0].avgRs).toBeCloseTo(65.5);
    expect(parsed.sectors[0].topIndustries).toHaveLength(1);

    // daily 모드에는 전일 대비 비교 필드 포함
    expect(parsed.sectors[0].prevDayRank).toBe(2);
    expect(parsed.sectors[0].rankChange).toBe(1); // 2 - 1 = +1
    expect(parsed.sectors[0].prevDayAvgRs).toBeCloseTo(60.0);
    expect(parsed.sectors[0].rsChange).toBeCloseTo(5.5);

    // weekly 전용 필드는 없어야 한다
    expect(parsed.sectors[0]).not.toHaveProperty("prevWeekRank");
    expect(parsed.sectors[0]).not.toHaveProperty("prevWeekAvgRs");
    expect(parsed).not.toHaveProperty("mode");
    expect(parsed).not.toHaveProperty("newEntrants");
    expect(parsed).not.toHaveProperty("exits");
  });

  it("mode: 'daily' — 전일 데이터 없으면 prevDayDate null", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [makeSectorRow()],
      })
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce({
        rows: [{ prev_day_date: null }],
      });

    const result = await getLeadingSectors.execute({
      date: "2026-03-07",
      mode: "daily",
    });
    const parsed = JSON.parse(result);

    expect(parsed.sectors).toHaveLength(1);
    expect(parsed.prevDayDate).toBeNull();
    // 비교 데이터 없으므로 prevDay 필드 없음
    expect(parsed.sectors[0]).not.toHaveProperty("prevDayRank");
  });

  it("mode: 'weekly' 시 전주 순위 포함", async () => {
    mockQuery
      // 1st: 당일 섹터
      .mockResolvedValueOnce({
        rows: [
          makeSectorRow({ sector: "Technology", rs_rank: 1, avg_rs: "70" }),
          makeSectorRow({ sector: "Healthcare", rs_rank: 2, avg_rs: "60" }),
        ],
      })
      // 2nd: 당일 업종
      .mockResolvedValueOnce({ rows: [] })
      // 3rd: 전주 날짜 조회
      .mockResolvedValueOnce({
        rows: [{ prev_week_date: "2026-02-28" }],
      })
      // 4th: 전주 섹터 랭킹 (limit 기반 — entrants/exits 판단용)
      .mockResolvedValueOnce({
        rows: [
          { sector: "Healthcare", avg_rs: "62", rs_rank: 1 },
          { sector: "Technology", avg_rs: "58", rs_rank: 2 },
        ],
      })
      // 5th: 전주 섹터 랭킹 (이름 기반 — 순위 비교용)
      .mockResolvedValueOnce({
        rows: [
          { sector: "Healthcare", avg_rs: "62", rs_rank: 1 },
          { sector: "Technology", avg_rs: "58", rs_rank: 2 },
        ],
      });

    const result = await getLeadingSectors.execute({
      date: "2026-03-07",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe("weekly");
    expect(parsed.date).toBe("2026-03-07");
    expect(parsed.prevWeekDate).toBe("2026-02-28");
    expect(parsed.sectors).toHaveLength(2);

    // Technology: 전주 2위 → 이번주 1위 = rankChange +1
    const tech = parsed.sectors.find(
      (s: Record<string, unknown>) => s.sector === "Technology",
    );
    expect(tech.prevWeekRank).toBe(2);
    expect(tech.rankChange).toBe(1);
    expect(tech.prevWeekAvgRs).toBeCloseTo(58);
    expect(tech.rsChange).toBeCloseTo(12);
  });

  it("rankChange 정확성 (전주 5위 → 이번주 2위 = +3)", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [makeSectorRow({ sector: "Energy", rs_rank: 2, avg_rs: "55" })],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ prev_week_date: "2026-02-28" }],
      })
      // 4th: limit 기반
      .mockResolvedValueOnce({
        rows: [{ sector: "Energy", avg_rs: "45", rs_rank: 5 }],
      })
      // 5th: 이름 기반
      .mockResolvedValueOnce({
        rows: [{ sector: "Energy", avg_rs: "45", rs_rank: 5 }],
      });

    const result = await getLeadingSectors.execute({
      date: "2026-03-07",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    const energy = parsed.sectors[0];
    expect(energy.rankChange).toBe(3); // 5 - 2 = +3
    expect(energy.prevWeekRank).toBe(5);
    expect(energy.rsChange).toBeCloseTo(10); // 55 - 45
  });

  it("newEntrants / exits 계산 정확성", async () => {
    mockQuery
      // 이번주: Technology, Energy (Healthcare 빠짐)
      .mockResolvedValueOnce({
        rows: [
          makeSectorRow({ sector: "Technology", rs_rank: 1, avg_rs: "70" }),
          makeSectorRow({ sector: "Energy", rs_rank: 2, avg_rs: "60" }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ prev_week_date: "2026-02-28" }],
      })
      // 4th: 전주 limit 기반 (entrants/exits 판단용)
      .mockResolvedValueOnce({
        rows: [
          { sector: "Technology", avg_rs: "65", rs_rank: 1 },
          { sector: "Healthcare", avg_rs: "55", rs_rank: 2 },
        ],
      })
      // 5th: 전주 이름 기반 (순위 비교용 — Energy는 전주 미존재)
      .mockResolvedValueOnce({
        rows: [
          { sector: "Technology", avg_rs: "65", rs_rank: 1 },
          { sector: "Healthcare", avg_rs: "55", rs_rank: 2 },
        ],
      });

    const result = await getLeadingSectors.execute({
      date: "2026-03-07",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    expect(parsed.newEntrants).toEqual(["Energy"]);
    expect(parsed.exits).toEqual(["Healthcare"]);
  });

  it("전주 데이터 없을 때 (prevWeekDate null) daily와 동일하게 동작", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [makeSectorRow({ sector: "Technology", rs_rank: 1 })],
      })
      .mockResolvedValueOnce({ rows: [] })
      // 전주 날짜 없음
      .mockResolvedValueOnce({ rows: [{ prev_week_date: null }] });

    const result = await getLeadingSectors.execute({
      date: "2026-03-07",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    // weekly 형식이지만 비교 데이터 없음
    expect(parsed.date).toBe("2026-03-07");
    expect(parsed.mode).toBe("weekly");
    expect(parsed.prevWeekDate).toBeNull();
    expect(parsed.note).toContain("이전 주 데이터 없음");
    expect(parsed.newEntrants).toEqual([]);
    expect(parsed.exits).toEqual([]);
    expect(parsed.sectors).toHaveLength(1);
  });

  it("daily 모드에서 섹터 쿼리는 LIMIT 50으로 전체 섹터를 조회한다", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeSectorRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ prev_day_date: null }] });

    await getLeadingSectors.execute({ date: "2026-03-07" });

    // 첫 번째 쿼리 (findTopSectors)의 두 번째 파라미터가 50이어야 함
    const firstCallParams = mockQuery.mock.calls[0][1];
    expect(firstCallParams[1]).toBe(50);
  });

  it("industry 모드에서 DB 쿼리는 항상 INDUSTRY_FETCH_LIMIT(50)으로 후보군을 가져온다", async () => {
    // 1st: findPrevWeekDate
    mockQuery.mockResolvedValueOnce({ rows: [{ prev_week_date: "2026-02-28" }] });
    // 2nd: findIndustriesWeeklyChange
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 3rd: findTopIndustriesGlobal
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeadingSectors.execute({ date: "2026-03-07", mode: "industry" });

    // findIndustriesWeeklyChange의 limit 파라미터가 50이어야 함
    const weeklyChangeParams = mockQuery.mock.calls[1][1];
    expect(weeklyChangeParams[2]).toBe(50);
  });

  it("industry 모드에서 changeWeek 경로(prevWeekDate 있음)는 섹터당 제한 없이 반환한다", async () => {
    const energyWeeklyRows = Array.from({ length: 5 }, (_, i) => ({
      sector: "Energy",
      industry: `Energy Ind ${i + 1}`,
      avg_rs: String(90 - i),
      rs_rank: i + 1,
      group_phase: 2,
      phase2_ratio: "0.80",
      change_week: String(10 - i),
    }));
    const energyGlobalRows = Array.from({ length: 5 }, (_, i) =>
      makeIndustryGlobalRow({ industry: `Energy Ind ${i + 1}`, sector: "Energy", avg_rs: String(90 - i) }),
    );

    // 1st: findPrevWeekDate
    mockQuery.mockResolvedValueOnce({ rows: [{ prev_week_date: "2026-02-28" }] });
    // 2nd: findIndustriesWeeklyChange
    mockQuery.mockResolvedValueOnce({ rows: energyWeeklyRows });
    // 3rd: findTopIndustriesGlobal
    mockQuery.mockResolvedValueOnce({ rows: energyGlobalRows });

    const result = await getLeadingSectors.execute({ date: "2026-03-07", mode: "industry" });
    const parsed = JSON.parse(result);

    // changeWeek 경로에서는 섹터당 제한 없음 — 한 섹터 집중은 자금 유입 신호
    const energyCount = parsed.industries.filter((i: { sector: string }) => i.sector === "Energy").length;
    expect(energyCount).toBe(5);
  });

  it("industry 모드에서 prevWeekDate 없으면 섹터당 2개 제한이 적용된다", async () => {
    const energyGlobalRows = Array.from({ length: 5 }, (_, i) =>
      makeIndustryGlobalRow({ industry: `Energy Ind ${i + 1}`, sector: "Energy", avg_rs: String(90 - i) }),
    );

    // 1st: findPrevWeekDate — null
    mockQuery.mockResolvedValueOnce({ rows: [{ prev_week_date: null }] });
    // 2nd: findTopIndustriesGlobal (fallback 경로)
    mockQuery.mockResolvedValueOnce({ rows: energyGlobalRows });

    const result = await getLeadingSectors.execute({ date: "2026-03-07", mode: "industry" });
    const parsed = JSON.parse(result);

    // prevWeekDate 없는 경로에서는 섹터당 2개 제한 적용
    const energyCount = parsed.industries.filter((i: { sector: string }) => i.sector === "Energy").length;
    expect(energyCount).toBe(2);
  });

  it("weekly 모드에서 전주에 없던 신규 섹터는 prevWeekRank가 null", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          makeSectorRow({ sector: "NewSector", rs_rank: 3, avg_rs: "50" }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ prev_week_date: "2026-02-28" }],
      })
      // 4th: 전주 limit 기반
      .mockResolvedValueOnce({
        rows: [{ sector: "OldSector", avg_rs: "48", rs_rank: 1 }],
      })
      // 5th: 전주 이름 기반 (NewSector는 전주 미존재)
      .mockResolvedValueOnce({
        rows: [{ sector: "OldSector", avg_rs: "48", rs_rank: 1 }],
      });

    const result = await getLeadingSectors.execute({
      date: "2026-03-07",
      mode: "weekly",
    });
    const parsed = JSON.parse(result);

    const newSector = parsed.sectors[0];
    expect(newSector.prevWeekRank).toBeNull();
    expect(newSector.rankChange).toBeNull();
    expect(newSector.prevWeekAvgRs).toBeNull();
    expect(newSector.rsChange).toBeNull();
  });
});
