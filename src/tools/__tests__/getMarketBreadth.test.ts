import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getMarketBreadth — 쿼리 필터 정합성 테스트.
 *
 * 검증 대상:
 * - daily/weekly 모드의 stock_phases 쿼리가 모두 symbols JOIN + 3개 필터를 포함하는지
 * - 잘못된 date 입력 시 에러 응답 반환
 * - totalStocks가 필터된 카운트를 반환
 *
 * DB는 mock 처리. 실제 Supabase 연결 없음.
 */

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { pool } from "@/db/client";
import { getMarketBreadth } from "../getMarketBreadth";

const mockQuery = vi.mocked(pool.query);

// ────────────────────────────────────────────
// 헬퍼: mock 체인 설정
// ────────────────────────────────────────────

function makeEmptyQueryMock() {
  return { rows: [] };
}

/**
 * daily 모드 mock setup.
 * 첫 번째 쿼리: findMarketBreadthSnapshot → null (스냅샷 없음 → 폴백 경로)
 * 이후: 기존 집계 쿼리 순서대로.
 */
function setupDailyMocks({
  phaseRows = [{ phase: 2, count: "30" }],
  prevRows = [{ phase2_count: "25", total_count: "100" }],
  rsRows = [{ avg_rs: "72.50" }],
  adRows = [{ advancers: "60", decliners: "40", unchanged: "10" }],
  hlRows = [{ new_highs: "15", new_lows: "5" }],
  sectorRows = [] as { sector: string; avg_rs: string; group_phase: number }[],
}: {
  phaseRows?: { phase: number; count: string }[];
  prevRows?: { phase2_count: string; total_count: string }[];
  rsRows?: { avg_rs: string }[];
  adRows?: { advancers: string; decliners: string; unchanged: string }[];
  hlRows?: { new_highs: string; new_lows: string }[];
  sectorRows?: { sector: string; avg_rs: string; group_phase: number }[];
} = {}) {
  mockQuery
    // findMarketBreadthSnapshot → 스냅샷 없음 → 폴백
    .mockResolvedValueOnce({ rows: [] } as never)
    // 폴백 집계 쿼리
    .mockResolvedValueOnce({ rows: phaseRows } as never)
    .mockResolvedValueOnce({ rows: prevRows } as never)
    .mockResolvedValueOnce({ rows: rsRows } as never)
    .mockResolvedValueOnce({ rows: adRows } as never)
    .mockResolvedValueOnce({ rows: hlRows } as never)
    .mockResolvedValueOnce({ rows: sectorRows } as never);
}

/**
 * weekly 모드 mock setup.
 * 쿼리 순서:
 *   1. findTradingDates → dateRows
 *   2. findMarketBreadthSnapshots → [] (스냅샷 없음 → 폴백)
 *   3. findWeeklyTrend → trendRows
 *   4. findWeeklyPhase1to2Transitions → transRows
 *   5. findPhaseDistribution → phaseRows
 *   6. findAdvanceDecline → adRows
 *   7. findNewHighLow → hlRows
 *   8. findBreadthTopSectors → sectorRows
 */
function setupWeeklyMocks({
  dateRows = [
    { date: "2025-03-10" },
    { date: "2025-03-11" },
    { date: "2025-03-12" },
    { date: "2025-03-13" },
    { date: "2025-03-14" },
  ],
  trendRows = [
    { date: "2025-03-10", total: "100", phase2_count: "25", avg_rs: "70.00" },
    { date: "2025-03-11", total: "100", phase2_count: "26", avg_rs: "71.00" },
    { date: "2025-03-12", total: "100", phase2_count: "27", avg_rs: "72.00" },
    { date: "2025-03-13", total: "100", phase2_count: "28", avg_rs: "73.00" },
    { date: "2025-03-14", total: "100", phase2_count: "30", avg_rs: "74.00" },
  ],
  transRows = [{ transitions: "8" }],
  phaseRows = [{ phase: 2, count: "30" }],
  adRows = [{ advancers: "60", decliners: "40", unchanged: "10" }],
  hlRows = [{ new_highs: "15", new_lows: "5" }],
  sectorRows = [] as { sector: string; avg_rs: string; group_phase: number }[],
}: {
  dateRows?: { date: string }[];
  trendRows?: {
    date: string;
    total: string;
    phase2_count: string;
    avg_rs: string;
  }[];
  transRows?: { transitions: string }[];
  phaseRows?: { phase: number; count: string }[];
  adRows?: { advancers: string; decliners: string; unchanged: string }[];
  hlRows?: { new_highs: string; new_lows: string }[];
  sectorRows?: { sector: string; avg_rs: string; group_phase: number }[];
} = {}) {
  mockQuery
    // findTradingDates
    .mockResolvedValueOnce({ rows: dateRows } as never)
    // findMarketBreadthSnapshots → 스냅샷 없음 → 폴백
    .mockResolvedValueOnce({ rows: [] } as never)
    // 폴백 집계 쿼리
    .mockResolvedValueOnce({ rows: trendRows } as never)
    .mockResolvedValueOnce({ rows: transRows } as never)
    .mockResolvedValueOnce({ rows: phaseRows } as never)
    .mockResolvedValueOnce({ rows: adRows } as never)
    .mockResolvedValueOnce({ rows: hlRows } as never)
    .mockResolvedValueOnce({ rows: sectorRows } as never);
}

// ────────────────────────────────────────────
// 쿼리 텍스트 추출 헬퍼
// ────────────────────────────────────────────

function getCapturedQueries(): string[] {
  return mockQuery.mock.calls.map((call) => {
    const sql = call[0] as string;
    return sql.replace(/\s+/g, " ").trim();
  });
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("getMarketBreadth", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("입력 유효성", () => {
    it("date가 없으면 에러 JSON을 반환한다", async () => {
      const result = await getMarketBreadth.execute({ date: undefined });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });

    it("date 형식이 잘못되면 에러 JSON을 반환한다", async () => {
      const result = await getMarketBreadth.execute({ date: "not-a-date" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });

  describe("daily 모드 — 쿼리 필터 정합성", () => {
    const TARGET_DATE = "2025-03-14";

    it("Phase 분포 쿼리가 symbols JOIN과 3개 필터를 포함한다", async () => {
      setupDailyMocks();

      await getMarketBreadth.execute({ date: TARGET_DATE });

      const queries = getCapturedQueries();
      // queries[0]: findMarketBreadthSnapshot (스냅샷 조회 → null)
      // queries[1]: Phase 분포 (폴백)
      const phaseQuery = queries[1];
      expect(phaseQuery).toContain("JOIN symbols s ON sp.symbol = s.symbol");
      expect(phaseQuery).toContain("s.is_actively_trading = true");
      expect(phaseQuery).toContain("s.is_etf = false");
      expect(phaseQuery).toContain("s.is_fund = false");
    });

    it("전일 Phase 2 비율 쿼리가 symbols JOIN과 3개 필터를 포함한다", async () => {
      setupDailyMocks();

      await getMarketBreadth.execute({ date: TARGET_DATE });

      const queries = getCapturedQueries();
      // queries[2]: 전일 Phase 2 비율 (폴백)
      const prevQuery = queries[2];
      expect(prevQuery).toContain("JOIN symbols s ON sp.symbol = s.symbol");
      expect(prevQuery).toContain("s.is_actively_trading = true");
      expect(prevQuery).toContain("s.is_etf = false");
      expect(prevQuery).toContain("s.is_fund = false");
    });

    it("시장 평균 RS 쿼리가 symbols JOIN과 3개 필터를 포함한다", async () => {
      setupDailyMocks();

      await getMarketBreadth.execute({ date: TARGET_DATE });

      const queries = getCapturedQueries();
      // queries[3]: 시장 평균 RS (폴백)
      const rsQuery = queries[3];
      expect(rsQuery).toContain("JOIN symbols s ON sp.symbol = s.symbol");
      expect(rsQuery).toContain("s.is_actively_trading = true");
      expect(rsQuery).toContain("s.is_etf = false");
      expect(rsQuery).toContain("s.is_fund = false");
    });

    it("totalStocks가 필터된 phase 카운트 합계를 반환한다", async () => {
      setupDailyMocks({
        phaseRows: [
          { phase: 1, count: "50" },
          { phase: 2, count: "30" },
          { phase: 3, count: "20" },
        ],
      });

      const result = await getMarketBreadth.execute({ date: TARGET_DATE });
      const parsed = JSON.parse(result);

      // 필터 이후 100개 (ETF/펀드 제외)
      expect(parsed.totalStocks).toBe(100);
    });

    it("phase2Ratio가 totalStocks 기준으로 정확히 계산된다", async () => {
      setupDailyMocks({
        phaseRows: [
          { phase: 1, count: "70" },
          { phase: 2, count: "30" },
        ],
        prevRows: [{ phase2_count: "20", total_count: "100" }],
      });

      const result = await getMarketBreadth.execute({ date: TARGET_DATE });
      const parsed = JSON.parse(result);

      // 30/100 = 30.0%
      expect(parsed.phase2Ratio).toBe(30.0);
    });

    it("유효한 date로 올바른 구조를 반환한다", async () => {
      setupDailyMocks();

      const result = await getMarketBreadth.execute({ date: TARGET_DATE });
      const parsed = JSON.parse(result);

      expect(parsed.date).toBe(TARGET_DATE);
      expect(parsed.totalStocks).toBeDefined();
      expect(parsed.phaseDistribution).toBeDefined();
      expect(parsed.phase2Ratio).toBeDefined();
      expect(parsed.phase2RatioChange).toBeDefined();
      expect(parsed.marketAvgRs).toBeDefined();
      expect(parsed.advanceDecline).toBeDefined();
      expect(parsed.newHighLow).toBeDefined();
    });
  });

  describe("weekly 모드 — 쿼리 필터 정합성", () => {
    const TARGET_DATE = "2025-03-14";

    it("주간 트렌드 쿼리가 symbols JOIN과 3개 필터를 포함한다", async () => {
      setupWeeklyMocks();

      await getMarketBreadth.execute({ date: TARGET_DATE, mode: "weekly" });

      const queries = getCapturedQueries();
      // queries[0]: findTradingDates, queries[1]: findMarketBreadthSnapshots(빈배열→폴백)
      // queries[2]: findWeeklyTrend (폴백)
      const trendQuery = queries[2];
      expect(trendQuery).toContain("JOIN symbols s ON sp.symbol = s.symbol");
      expect(trendQuery).toContain("s.is_actively_trading = true");
      expect(trendQuery).toContain("s.is_etf = false");
      expect(trendQuery).toContain("s.is_fund = false");
    });

    it("Phase 1→2 전환 쿼리가 symbols JOIN과 3개 필터를 포함한다", async () => {
      setupWeeklyMocks();

      await getMarketBreadth.execute({ date: TARGET_DATE, mode: "weekly" });

      const queries = getCapturedQueries();
      // queries[3]: findWeeklyPhase1to2Transitions (폴백)
      const transQuery = queries[3];
      expect(transQuery).toContain("JOIN symbols s ON sp.symbol = s.symbol");
      expect(transQuery).toContain("s.is_actively_trading = true");
      expect(transQuery).toContain("s.is_etf = false");
      expect(transQuery).toContain("s.is_fund = false");
    });

    it("최신 날짜 Phase 분포 쿼리가 symbols JOIN과 3개 필터를 포함한다", async () => {
      setupWeeklyMocks();

      await getMarketBreadth.execute({ date: TARGET_DATE, mode: "weekly" });

      const queries = getCapturedQueries();
      // queries[4]: findPhaseDistribution (폴백, 최신 날짜)
      const phaseQuery = queries[4];
      expect(phaseQuery).toContain("JOIN symbols s ON sp.symbol = s.symbol");
      expect(phaseQuery).toContain("s.is_actively_trading = true");
      expect(phaseQuery).toContain("s.is_etf = false");
      expect(phaseQuery).toContain("s.is_fund = false");
    });

    it("날짜 데이터가 없으면 에러 JSON을 반환한다", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await getMarketBreadth.execute({
        date: TARGET_DATE,
        mode: "weekly",
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
    });

    it("유효한 date로 weekly 구조를 반환한다", async () => {
      setupWeeklyMocks();

      const result = await getMarketBreadth.execute({
        date: TARGET_DATE,
        mode: "weekly",
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe("weekly");
      expect(parsed.dates).toBeDefined();
      expect(parsed.weeklyTrend).toBeDefined();
      expect(parsed.phase1to2Transitions).toBeDefined();
      expect(parsed.latestSnapshot).toBeDefined();
    });

    it("weeklyTrend phase2Ratio가 필터된 종목 수 기준으로 계산된다", async () => {
      setupWeeklyMocks({
        trendRows: [
          {
            date: "2025-03-10",
            total: "132",
            phase2_count: "40",
            avg_rs: "70.00",
          },
        ],
        dateRows: [{ date: "2025-03-10" }],
      });

      const result = await getMarketBreadth.execute({
        date: TARGET_DATE,
        mode: "weekly",
      });
      const parsed = JSON.parse(result);

      // 40/132 = 30.3%
      const ratio = parsed.weeklyTrend[0]?.phase2Ratio;
      expect(ratio).toBeCloseTo(30.3, 1);
    });
  });

  describe("daily 모드 기본값", () => {
    it("mode 파라미터 없이도 daily로 동작한다", async () => {
      setupDailyMocks();

      const result = await getMarketBreadth.execute({ date: "2025-03-14" });
      const parsed = JSON.parse(result);

      // weekly 구조가 아님
      expect(parsed.mode).toBeUndefined();
      expect(parsed.date).toBe("2025-03-14");
    });

    it("mode가 invalid 값이면 daily로 폴백한다", async () => {
      setupDailyMocks();

      const result = await getMarketBreadth.execute({
        date: "2025-03-14",
        mode: "invalid",
      });
      const parsed = JSON.parse(result);

      expect(parsed.date).toBe("2025-03-14");
      expect(parsed.mode).toBeUndefined();
    });
  });
});
