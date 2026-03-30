import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getLeadingSectors — mode: 'industry' 단위 테스트.
 *
 * 검증 대상:
 * - mode: 'industry'로 호출 시 findTopIndustriesGlobal이 호출된다
 * - divergence 계산: industryRs - sectorRs (소수점 2자리)
 * - sector_avg_rs가 null일 때 divergence가 null로 처리된다
 * - phase2Ratio가 DB값 × 100으로 변환된다 (0~100 퍼센트)
 * - 기존 daily 모드 회귀 없음 — findTopSectors가 호출된다
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
import { getLeadingSectors } from "../getLeadingSectors";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

const BASE_INDUSTRY_ROW = {
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

function makeIndustryRow(
  overrides: Partial<typeof BASE_INDUSTRY_ROW>,
): typeof BASE_INDUSTRY_ROW {
  return { ...BASE_INDUSTRY_ROW, ...overrides };
}

// ─── mode: 'industry' ────────────────────────────────────────────────────────

describe("mode: 'industry'", () => {
  it("findTopIndustriesGlobal(JOIN 쿼리)을 호출하고 industries 배열을 반환한다", async () => {
    const row = makeIndustryRow({});
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
      limit: 5,
    });

    const parsed = JSON.parse(result);
    expect(parsed.mode).toBe("industry");
    expect(parsed.date).toBe("2026-03-28");
    expect(Array.isArray(parsed.industries)).toBe(true);
    expect(parsed.industries).toHaveLength(1);
  });

  it("divergence = avgRs - sectorAvgRs (소수점 2자리)", async () => {
    // industryRs=70, sectorRs=50 → divergence=20.00
    const row = makeIndustryRow({ avg_rs: "70.00", sector_avg_rs: "50.00" });
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.industries[0].divergence).toBe(20);
  });

  it("divergence 계산 시 소수점 처리: 70.75 - 50.50 = 20.25", async () => {
    const row = makeIndustryRow({ avg_rs: "70.75", sector_avg_rs: "50.50" });
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.industries[0].divergence).toBe(20.25);
  });

  it("sector_avg_rs가 null이면 divergence도 null이다", async () => {
    const row = makeIndustryRow({ sector_avg_rs: null, sector_rs_rank: null });
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.industries[0].divergence).toBeNull();
    expect(parsed.industries[0].sectorAvgRs).toBeNull();
  });

  it("phase2Ratio는 DB값 × 100으로 변환된다 (0.57 → 57)", async () => {
    const row = makeIndustryRow({ phase2_ratio: "0.57" });
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.industries[0].phase2Ratio).toBe(57);
  });

  it("응답에 _note 필드가 포함된다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed._note).toBeTruthy();
    expect(typeof parsed._note).toBe("string");
  });

  it("change4w가 null이면 null로 반환된다", async () => {
    const row = makeIndustryRow({ change_4w: null });
    mockQuery.mockResolvedValueOnce({ rows: [row] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-28",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.industries[0].change4w).toBeNull();
  });

  it("잘못된 date 입력 시 error 객체를 반환한다", async () => {
    const result = await getLeadingSectors.execute({
      date: "not-a-date",
      mode: "industry",
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toBeTruthy();
  });
});

// ─── 기존 daily 모드 회귀 테스트 ──────────────────────────────────────────────

describe("기존 daily 모드 회귀", () => {
  it("mode: 'daily'일 때 findTopSectors를 호출한다 (findTopIndustriesGlobal 미호출)", async () => {
    // daily 모드: findTopSectors → findTopIndustries → findPrevDayDate → findSectorsByDateAndNames
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
      .mockResolvedValueOnce({ rows: [] } as never); // findSectorsByDateAndNames

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
