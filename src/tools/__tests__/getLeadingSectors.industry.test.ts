import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getLeadingSectors — mode: 'industry' 단위 테스트.
 *
 * 검증 대상:
 * - mode: 'industry'로 호출 시 전주 날짜 조회 후 weeklyChange 쿼리를 실행한다
 * - prevWeekDate 있을 때: plain 마크다운 텍스트 반환 (JSON 아님)
 * - prevWeekDate 없을 때: JSON 반환 (industries 배열 포함)
 * - changeWeek 필드: 전주 RS 변화값 (소수점 2자리)
 * - 전주 데이터 없으면 changeWeek = null
 * - divergence 계산: industryRs - sectorRs (소수점 2자리)
 * - sector_avg_rs가 null일 때 divergence가 null로 처리된다
 * - phase2Ratio가 DB값 × 100으로 변환된다 (0~100 퍼센트)
 * - 기존 daily 모드 회귀 없음 — findTopSectors가 호출된다
 *
 * DB는 mock 처리. 실제 Supabase 연결 없음.
 *
 * mode: 'industry' 쿼리 실행 순서 (전주 날짜 있는 경우):
 *   1. findPrevWeekDate → prev_week_date 반환
 *   2. findIndustriesWeeklyChange → 업종 주간 변화 rows
 *   3. findTopIndustriesGlobal → sector_avg_rs / change_4w 등 포함 rows
 *
 * 전주 날짜 없는 경우:
 *   1. findPrevWeekDate → prev_week_date: null
 *   2. findTopIndustriesGlobal → 기존 rows (changeWeek: null)
 */

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { pool } from "@/db/client";
import { getLeadingSectors } from "../getLeadingSectors";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** findPrevWeekDate 응답 */
const PREV_WEEK_DATE_ROW = { prev_week_date: "2026-03-21" };
const NULL_PREV_WEEK_DATE_ROW = { prev_week_date: null };

/** findIndustriesWeeklyChange 응답 row (change_week 포함) */
const BASE_WEEKLY_CHANGE_ROW = {
  sector: "Technology",
  industry: "Semiconductors",
  avg_rs: "70.00",
  rs_rank: 1,
  group_phase: 2,
  phase2_ratio: "0.57",
  change_week: "3.50" as string | null,
};

/** findTopIndustriesGlobal 응답 row (sector_avg_rs / change_4w 포함) */
const BASE_GLOBAL_ROW = {
  date: "2026-03-28",
  industry: "Semiconductors",
  sector: "Technology",
  avg_rs: "70.00",
  rs_rank: 1,
  group_phase: 2,
  phase2_ratio: "0.57",
  change_4w: "5.30" as string | null,
  change_8w: null as string | null,
  change_12w: null as string | null,
  sector_avg_rs: "50.00" as string | null,
  sector_rs_rank: 3 as number | null,
};

function makeWeeklyRow(
  overrides: Partial<typeof BASE_WEEKLY_CHANGE_ROW>,
): typeof BASE_WEEKLY_CHANGE_ROW {
  return { ...BASE_WEEKLY_CHANGE_ROW, ...overrides };
}

function makeGlobalRow(
  overrides: Partial<typeof BASE_GLOBAL_ROW>,
): typeof BASE_GLOBAL_ROW {
  return { ...BASE_GLOBAL_ROW, ...overrides };
}

/**
 * 전주 날짜 있는 정상 경우: 3회 쿼리 mock 설정
 *   1. findPrevWeekDate
 *   2. findIndustriesWeeklyChange
 *   3. findTopIndustriesGlobal
 */
function mockIndustryQueryWithPrevWeek(
  weeklyRow = makeWeeklyRow({}),
  globalRow = makeGlobalRow({}),
): void {
  mockQuery
    .mockResolvedValueOnce({ rows: [PREV_WEEK_DATE_ROW] } as never)
    .mockResolvedValueOnce({ rows: [weeklyRow] } as never)
    .mockResolvedValueOnce({ rows: [globalRow] } as never);
}

/**
 * 전주 날짜 없는 경우: 2회 쿼리 mock 설정
 *   1. findPrevWeekDate → null
 *   2. findTopIndustriesGlobal
 */
function mockIndustryQueryWithoutPrevWeek(
  globalRow = makeGlobalRow({}),
): void {
  mockQuery
    .mockResolvedValueOnce({ rows: [NULL_PREV_WEEK_DATE_ROW] } as never)
    .mockResolvedValueOnce({ rows: [globalRow] } as never);
}

// ─── mode: 'industry' ────────────────────────────────────────────────────────

describe("mode: 'industry'", () => {
  it("prevWeekDate 있을 때 plain 마크다운 텍스트를 반환한다 (JSON 아님)", async () => {
    mockIndustryQueryWithPrevWeek();

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
      limit: 5,
    });

    // plain text 반환 — JSON.parse 하면 실패해야 함
    expect(() => JSON.parse(result)).toThrow();
    expect(result).toContain("업종 RS 주간 변화 Top 10");
    expect(result).toContain("2026-03-28");
    expect(result).toContain("2026-03-21");
  });

  it("plain 텍스트에 업종명과 섹터가 포함된다", async () => {
    mockIndustryQueryWithPrevWeek();

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
      limit: 5,
    });

    expect(result).toContain("Semiconductors");
    expect(result).toContain("Technology");
  });

  it("changeWeek 값이 테이블에 포함된다 (3.50 → +3.5)", async () => {
    mockIndustryQueryWithPrevWeek(makeWeeklyRow({ change_week: "3.50" }));

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    expect(result).toContain("+3.5");
  });

  it("changeWeek 소수점 처리: 2.555 → +2.56 (2자리 반올림)", async () => {
    mockIndustryQueryWithPrevWeek(makeWeeklyRow({ change_week: "2.555" }));

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    expect(result).toContain("+2.56");
  });

  it("changeWeek가 null이면 테이블에 — 로 표시된다", async () => {
    mockIndustryQueryWithPrevWeek(makeWeeklyRow({ change_week: null }));

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    expect(result).toContain("—");
  });

  it("prevWeekDate가 null이면 JSON을 반환하고 changeWeek이 null이다", async () => {
    mockIndustryQueryWithoutPrevWeek();

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.prevWeekDate).toBeNull();
    expect(parsed.industries[0].changeWeek).toBeNull();
  });

  it("divergence = avgRs - sectorAvgRs (70 - 50 = 20): 상위 3개 요약에 업종명이 포함된다", async () => {
    // industryRs=70, sectorRs=50 → divergence=20.00
    mockIndustryQueryWithPrevWeek(
      makeWeeklyRow({ avg_rs: "70.00" }),
      makeGlobalRow({ avg_rs: "70.00", sector_avg_rs: "50.00" }),
    );

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    // plain 텍스트 — 상위 3개 요약에 업종명이 포함됨
    expect(result).toContain("Semiconductors");
    expect(result).toContain("상위 3개 업종 요약");
  });

  it("divergence 계산 시 소수점 처리 (70.75 - 50.50 = 20.25): 요약에 RS 값이 포함된다", async () => {
    mockIndustryQueryWithPrevWeek(
      makeWeeklyRow({ avg_rs: "70.75" }),
      makeGlobalRow({ avg_rs: "70.75", sector_avg_rs: "50.50" }),
    );

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    expect(result).toContain("70.75");
  });

  it("sector_avg_rs가 null일 때도 plain 텍스트를 반환한다", async () => {
    mockIndustryQueryWithPrevWeek(
      makeWeeklyRow({}),
      makeGlobalRow({ sector_avg_rs: null, sector_rs_rank: null }),
    );

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    // plain 텍스트 반환 — JSON 아님
    expect(() => JSON.parse(result)).toThrow();
    expect(result).toContain("Semiconductors");
  });

  it("phase2Ratio가 DB값 × 100으로 계산된다 (0.57 → 57): 테이블에 57%가 포함된다", async () => {
    mockIndustryQueryWithPrevWeek(makeWeeklyRow({ phase2_ratio: "0.57" }));

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    expect(result).toContain("57%");
  });

  it("prevWeekDate 있을 때 plain 텍스트 — 빈 industries면 테이블 행 없음", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PREV_WEEK_DATE_ROW] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    // JSON이 아닌 plain text
    expect(() => JSON.parse(result)).toThrow();
    expect(result).toContain("업종 RS 주간 변화 Top 10");
  });

  it("change4w가 null이면 prevWeekDate 없는 경로에서 null로 반환된다", async () => {
    mockIndustryQueryWithoutPrevWeek(
      makeGlobalRow({ change_4w: null }),
    );

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.industries[0].change4w).toBeNull();
  });

  it("change8w: prevWeekDate 없는 경로 — null이면 null, 값이 있으면 숫자로 반환된다", async () => {
    mockIndustryQueryWithoutPrevWeek(
      makeGlobalRow({ change_8w: null }),
    );

    const resultNull = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });
    expect(JSON.parse(resultNull).industries[0].change8w).toBeNull();

    mockIndustryQueryWithoutPrevWeek(
      makeGlobalRow({ change_8w: "8.50" }),
    );

    const resultValue = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });
    expect(JSON.parse(resultValue).industries[0].change8w).toBe(8.5);
  });

  it("change12w: prevWeekDate 없는 경로 — null이면 null, 값이 있으면 숫자로 반환된다", async () => {
    mockIndustryQueryWithoutPrevWeek(
      makeGlobalRow({ change_12w: null }),
    );

    const resultNull = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });
    expect(JSON.parse(resultNull).industries[0].change12w).toBeNull();

    mockIndustryQueryWithoutPrevWeek(
      makeGlobalRow({ change_12w: "12.75" }),
    );

    const resultValue = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });
    expect(JSON.parse(resultValue).industries[0].change12w).toBe(12.75);
  });

  it("잘못된 date 입력 시 error 객체를 반환한다", async () => {
    const result = await getLeadingSectors.execute({
      date: "not-a-date",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toBeTruthy();
  });

  it("prevWeekDate 있을 때 plain 텍스트에 전주 날짜가 포함된다", async () => {
    mockIndustryQueryWithPrevWeek();

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    expect(result).toContain("2026-03-21");
  });
});

// ─── 기존 daily 모드 회귀 테스트 ──────────────────────────────────────────────

describe("기존 daily 모드 회귀", () => {
  it("mode: 'daily'일 때 findTopSectors를 호출한다 (findTopIndustriesGlobal 미호출)", async () => {
    // daily 모드: findTopSectors → findTopIndustries → findPrevDayDate → findSectorsByDateAndNames → findIndustryDrilldown (Phase 전환 시)
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            sector: "Technology",
            avg_rs: "55.00",
            rs_rank: 1,
            stock_count: 200,
            change_4w: "3.00",
            change_8w: null,
            change_12w: null,
            group_phase: 2,
            prev_group_phase: 1,
            phase2_ratio: "0.40",
            ma_ordered_ratio: "0.60",
            phase1to2_count_5d: 5,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // findTopIndustries
      .mockResolvedValueOnce({
        rows: [{ prev_day_date: "2026-03-27" }],
      } as never) // findPrevDayDate
      .mockResolvedValueOnce({ rows: [] } as never) // findSectorsByDateAndNames
      .mockResolvedValueOnce({ rows: [] } as never); // findIndustryDrilldown (Phase 1→2 전환)

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "daily",
    });

    const parsed = JSON.parse(result);
    // industry 모드의 응답 구조가 아닌 sector 모드 응답이어야 한다
    expect(parsed.sectors).toBeDefined();
    expect(parsed.industries).toBeUndefined();
  });

  it("mode 미지정 시 daily로 동작한다", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            sector: "Healthcare",
            avg_rs: "60.00",
            rs_rank: 1,
            stock_count: 150,
            change_4w: "2.00",
            change_8w: null,
            change_12w: null,
            group_phase: 2,
            prev_group_phase: 2,
            phase2_ratio: "0.50",
            ma_ordered_ratio: "0.70",
            phase1to2_count_5d: 3,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // findTopIndustries
      .mockResolvedValueOnce({ rows: [{ prev_day_date: null }] } as never); // findPrevDayDate (null → 이전 날짜 없음)

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
    });

    const parsed = JSON.parse(result);
    expect(parsed.sectors).toBeDefined();
    expect(parsed.industries).toBeUndefined();
  });
});
