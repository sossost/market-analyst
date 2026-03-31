import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IndustryDrilldownRow } from "@/db/repositories/types";

/**
 * Phase 전환 드릴다운 — 단위 테스트.
 *
 * 검증 대상:
 * - buildPhaseTransitionDrilldown 순수 함수: RS 변화 상위, Phase 이상, Phase2 비율 계산
 * - getLeadingSectors daily 모드에 phaseTransitionDrilldown 포함 여부
 * - Phase 전환 없는 섹터에서는 드릴다운 미생성
 */

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { pool } from "@/db/client";
import { buildPhaseTransitionDrilldown } from "../getLeadingSectors";
import { getLeadingSectors } from "../getLeadingSectors";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── buildPhaseTransitionDrilldown 순수 함수 테스트 ───────────────────────────

describe("buildPhaseTransitionDrilldown", () => {
  it("빈 배열이면 빈 객체를 반환한다", () => {
    const result = buildPhaseTransitionDrilldown([]);
    expect(result).toEqual({});
  });

  it("RS 변화 상위 5개 업종을 반환한다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Financial Services", industry: "Ind-A", avg_rs: "60.00", group_phase: 2, prev_group_phase: 2, rs_change: "3.00" },
      { sector: "Financial Services", industry: "Ind-B", avg_rs: "55.00", group_phase: 3, prev_group_phase: 3, rs_change: "2.50" },
      { sector: "Financial Services", industry: "Ind-C", avg_rs: "50.00", group_phase: 2, prev_group_phase: 2, rs_change: "2.00" },
      { sector: "Financial Services", industry: "Ind-D", avg_rs: "45.00", group_phase: 3, prev_group_phase: 3, rs_change: "1.50" },
      { sector: "Financial Services", industry: "Ind-E", avg_rs: "40.00", group_phase: 3, prev_group_phase: 3, rs_change: "1.00" },
      { sector: "Financial Services", industry: "Ind-F", avg_rs: "35.00", group_phase: 3, prev_group_phase: 3, rs_change: "0.50" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    expect(result["Financial Services"].topRsChange).toHaveLength(5);
    expect(result["Financial Services"].topRsChange[0].industry).toBe("Ind-A");
    expect(result["Financial Services"].topRsChange[0].rsChange).toBe(3);
  });

  it("Phase 역행 업종(Phase 악화)을 감지한다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Technology", industry: "Semiconductors", avg_rs: "70.00", group_phase: 3, prev_group_phase: 1, rs_change: "1.50" },
      { sector: "Technology", industry: "Software", avg_rs: "65.00", group_phase: 2, prev_group_phase: 2, rs_change: "1.00" },
      { sector: "Technology", industry: "Hardware", avg_rs: "60.00", group_phase: 2, prev_group_phase: 3, rs_change: "0.50" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    // Semiconductors: 1→3 (악화, prev < curr 숫자 기준)
    expect(result["Technology"].phaseAnomalies).toHaveLength(1);
    expect(result["Technology"].phaseAnomalies[0].industry).toBe("Semiconductors");
    expect(result["Technology"].phaseAnomalies[0].prevGroupPhase).toBe(1);
    expect(result["Technology"].phaseAnomalies[0].groupPhase).toBe(3);
  });

  it("Phase 개선(숫자 감소)은 이상 업종으로 분류하지 않는다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Healthcare", industry: "Biotech", avg_rs: "60.00", group_phase: 2, prev_group_phase: 3, rs_change: "2.00" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    expect(result["Healthcare"].phaseAnomalies).toHaveLength(0);
  });

  it("Phase2 업종 비율을 정확히 계산한다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Financials", industry: "A", avg_rs: "60.00", group_phase: 2, prev_group_phase: 2, rs_change: "1.00" },
      { sector: "Financials", industry: "B", avg_rs: "55.00", group_phase: 2, prev_group_phase: 2, rs_change: "0.80" },
      { sector: "Financials", industry: "C", avg_rs: "50.00", group_phase: 3, prev_group_phase: 3, rs_change: "0.50" },
      { sector: "Financials", industry: "D", avg_rs: "45.00", group_phase: 1, prev_group_phase: 1, rs_change: "0.30" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    expect(result["Financials"].phase2Ratio).toEqual({
      count: 2,
      total: 4,
      percent: 50,
    });
  });

  it("여러 섹터의 드릴다운을 분리하여 반환한다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Tech", industry: "Software", avg_rs: "70.00", group_phase: 2, prev_group_phase: 2, rs_change: "2.00" },
      { sector: "Health", industry: "Pharma", avg_rs: "60.00", group_phase: 2, prev_group_phase: 2, rs_change: "1.50" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    expect(Object.keys(result)).toEqual(["Tech", "Health"]);
    expect(result["Tech"].topRsChange).toHaveLength(1);
    expect(result["Health"].topRsChange).toHaveLength(1);
  });

  it("rs_change가 null인 업종은 topRsChange에서 제외한다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Energy", industry: "Oil", avg_rs: "50.00", group_phase: 2, prev_group_phase: 2, rs_change: null },
      { sector: "Energy", industry: "Gas", avg_rs: "45.00", group_phase: 3, prev_group_phase: 3, rs_change: "1.00" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    expect(result["Energy"].topRsChange).toHaveLength(1);
    expect(result["Energy"].topRsChange[0].industry).toBe("Gas");
  });

  it("prev_group_phase가 null이면 Phase 이상 업종으로 분류하지 않는다", () => {
    const rows: IndustryDrilldownRow[] = [
      { sector: "Tech", industry: "AI", avg_rs: "80.00", group_phase: 3, prev_group_phase: null, rs_change: "5.00" },
    ];

    const result = buildPhaseTransitionDrilldown(rows);
    expect(result["Tech"].phaseAnomalies).toHaveLength(0);
  });
});

// ─── getLeadingSectors daily 모드 드릴다운 통합 테스트 ────────────────────────

describe("getLeadingSectors daily 모드 — Phase 전환 드릴다운", () => {
  it("Phase 전환 섹터가 있으면 phaseTransitionDrilldown을 포함한다", async () => {
    // findTopSectors: Phase 전환 섹터 1개
    mockQuery.mockResolvedValueOnce({
      rows: [{
        sector: "Financial Services",
        avg_rs: "50.00",
        rs_rank: 3,
        stock_count: 100,
        change_4w: "2.00",
        change_8w: null,
        change_12w: null,
        group_phase: 2,
        prev_group_phase: 3,
        phase2_ratio: "0.30",
        ma_ordered_ratio: "0.50",
        phase1to2_count_5d: 2,
      }],
    } as never);
    // findTopIndustries
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    // findPrevDayDate
    mockQuery.mockResolvedValueOnce({
      rows: [{ prev_day_date: "2026-03-29" }],
    } as never);
    // findSectorsByDateAndNames (prevDay comparison)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    // findIndustryDrilldown
    mockQuery.mockResolvedValueOnce({
      rows: [
        { sector: "Financial Services", industry: "Insurance", avg_rs: "65.00", group_phase: 2, prev_group_phase: 2, rs_change: "1.89" },
        { sector: "Financial Services", industry: "Banks - Regional", avg_rs: "64.00", group_phase: 3, prev_group_phase: 1, rs_change: "1.67" },
      ],
    } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-30",
      mode: "daily",
    });

    const parsed = JSON.parse(result);
    expect(parsed.phaseTransitionDrilldown).toBeDefined();
    expect(parsed.phaseTransitionDrilldown["Financial Services"]).toBeDefined();
    expect(parsed.phaseTransitionDrilldown["Financial Services"].topRsChange).toHaveLength(2);
    expect(parsed.phaseTransitionDrilldown["Financial Services"].phaseAnomalies).toHaveLength(1);
    expect(parsed.phaseTransitionDrilldown["Financial Services"].phaseAnomalies[0].industry).toBe("Banks - Regional");
    expect(parsed.phaseTransitionDrilldown["Financial Services"].phase2Ratio.percent).toBe(50);
  });

  it("Phase 전환 섹터가 없으면 phaseTransitionDrilldown이 없다", async () => {
    // findTopSectors: 전환 없음
    mockQuery.mockResolvedValueOnce({
      rows: [{
        sector: "Technology",
        avg_rs: "60.00",
        rs_rank: 1,
        stock_count: 200,
        change_4w: "3.00",
        change_8w: null,
        change_12w: null,
        group_phase: 2,
        prev_group_phase: 2,
        phase2_ratio: "0.50",
        ma_ordered_ratio: "0.70",
        phase1to2_count_5d: 5,
      }],
    } as never);
    // findTopIndustries
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    // findPrevDayDate
    mockQuery.mockResolvedValueOnce({
      rows: [{ prev_day_date: "2026-03-29" }],
    } as never);
    // findSectorsByDateAndNames
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await getLeadingSectors.execute({
      date: "2026-03-30",
      mode: "daily",
    });

    const parsed = JSON.parse(result);
    expect(parsed.phaseTransitionDrilldown).toBeUndefined();
  });
});
