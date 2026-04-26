/**
 * 컴포넌트 KPI 쿼리 함수 단위 테스트.
 *
 * DB 연결 없이 쿼리 구조(SQL 포함 여부, 반환 타입)를 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import {
  queryComponentKpiEtl,
  queryComponentKpiAgentSource,
  queryComponentKpiAgentRetention,
  queryComponentKpiNarrativeChains,
  queryComponentKpiCorporateAnalyst,
} from "../stockPhaseRepository.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

// ─── queryComponentKpiEtl ─────────────────────────────────────────────────────

describe("queryComponentKpiEtl", () => {
  it("tracked_stocks, stock_phases 테이블을 쿼리한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await queryComponentKpiEtl(pool);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("tracked_stocks");
    expect(sql).toContain("stock_phases");
    expect(sql).toContain("etl_auto");
    expect(sql).toContain("featured");
  });

  it("rows가 비어있을 때 기본값 row를 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await queryComponentKpiEtl(pool);

    expect(result.new_count_7d).toBe(0);
    expect(result.total_active_etl).toBe(0);
    expect(result.featured_count).toBe(0);
    expect(result.featured_rate).toBeNull();
    expect(result.phase2_transition_7d).toBe(0);
    expect(result.registration_rate).toBeNull();
  });

  it("DB 결과를 그대로 반환한다", async () => {
    const mockRow = {
      new_count_7d: 12,
      total_active_etl: 85,
      featured_count: 9,
      featured_rate: 10.6,
      phase2_transition_7d: 45,
      registration_rate: 26.7,
    };
    mockQuery.mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 } as never);

    const result = await queryComponentKpiEtl(pool);

    expect(result.new_count_7d).toBe(12);
    expect(result.featured_rate).toBe(10.6);
    expect(result.registration_rate).toBe(26.7);
  });

  it("pool을 파라미터로 받아 실행한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await queryComponentKpiEtl(pool);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ─── queryComponentKpiAgentSource ────────────────────────────────────────────

describe("queryComponentKpiAgentSource", () => {
  it("source, tier별 그룹 집계 쿼리를 실행한다", async () => {
    await queryComponentKpiAgentSource(pool);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("tracked_stocks");
    expect(sql).toContain("source");
    expect(sql).toContain("tier");
    expect(sql).toContain("GROUP BY");
  });

  it("rows가 비어있으면 빈 배열을 반환한다", async () => {
    const result = await queryComponentKpiAgentSource(pool);

    expect(result).toEqual([]);
  });

  it("source/tier/cnt 구조를 반환한다", async () => {
    const mockRows = [
      { source: "etl_auto", tier: "standard", cnt: 72 },
      { source: "etl_auto", tier: "featured", cnt: 9 },
      { source: "agent", tier: "featured", cnt: 5 },
    ];
    mockQuery.mockResolvedValueOnce({ rows: mockRows, rowCount: 3 } as never);

    const result = await queryComponentKpiAgentSource(pool);

    expect(result).toHaveLength(3);
    expect(result[0].source).toBe("etl_auto");
    expect(result[0].tier).toBe("standard");
    expect(result[0].cnt).toBe(72);
  });
});

// ─── queryComponentKpiAgentRetention ─────────────────────────────────────────

describe("queryComponentKpiAgentRetention", () => {
  it("featured tier ACTIVE 종목을 대상으로 조회한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await queryComponentKpiAgentRetention(pool);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("featured");
    expect(sql).toContain("ACTIVE");
    expect(sql).toContain("days_tracked");
    expect(sql).toContain("current_phase");
    expect(sql).toContain("return_30d");
  });

  it("rows가 비어있을 때 기본값 row를 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await queryComponentKpiAgentRetention(pool);

    expect(result.total_featured).toBe(0);
    expect(result.total_at_14d).toBe(0);
    expect(result.phase2_at_14d).toBe(0);
    expect(result.total_at_28d).toBe(0);
    expect(result.phase2_at_28d).toBe(0);
    expect(result.avg_return_30d).toBeNull();
  });

  it("DB 결과를 그대로 반환한다", async () => {
    const mockRow = {
      total_featured: 14,
      total_at_14d: 12,
      phase2_at_14d: 10,
      total_at_28d: 10,
      phase2_at_28d: 8,
      avg_return_30d: 7.3,
    };
    mockQuery.mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 } as never);

    const result = await queryComponentKpiAgentRetention(pool);

    expect(result.total_featured).toBe(14);
    expect(result.total_at_14d).toBe(12);
    expect(result.phase2_at_14d).toBe(10);
    expect(result.total_at_28d).toBe(10);
    expect(result.phase2_at_28d).toBe(8);
    expect(result.avg_return_30d).toBe(7.3);
  });
});

// ─── queryComponentKpiNarrativeChains ────────────────────────────────────────

describe("queryComponentKpiNarrativeChains", () => {
  it("narrative_chains, stock_phases, tracked_stocks를 쿼리한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await queryComponentKpiNarrativeChains(pool);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("narrative_chains");
    expect(sql).toContain("stock_phases");
    expect(sql).toContain("tracked_stocks");
    expect(sql).toContain("ACTIVE");
    expect(sql).toContain("RESOLVING");
    expect(sql).toContain("beneficiary_tickers");
    expect(sql).toContain("thesis_aligned");
  });

  it("JSONB 배열 UNNEST를 사용한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await queryComponentKpiNarrativeChains(pool);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("jsonb_array_elements_text");
  });

  it("rows가 비어있을 때 기본값 row를 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await queryComponentKpiNarrativeChains(pool);

    expect(result.active_chain_count).toBe(0);
    expect(result.total_beneficiary_tickers).toBe(0);
    expect(result.phase2_beneficiary_count).toBe(0);
    expect(result.phase2_beneficiary_rate).toBeNull();
    expect(result.thesis_aligned_count).toBe(0);
    expect(result.thesis_aligned_rate).toBeNull();
  });

  it("DB 결과를 그대로 반환한다", async () => {
    const mockRow = {
      active_chain_count: 4,
      total_beneficiary_tickers: 22,
      phase2_beneficiary_count: 8,
      phase2_beneficiary_rate: 36.4,
      thesis_aligned_count: 5,
      thesis_aligned_rate: 22.7,
    };
    mockQuery.mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 } as never);

    const result = await queryComponentKpiNarrativeChains(pool);

    expect(result.active_chain_count).toBe(4);
    expect(result.phase2_beneficiary_rate).toBe(36.4);
    expect(result.thesis_aligned_rate).toBe(22.7);
  });
});

// ─── queryComponentKpiCorporateAnalyst ───────────────────────────────────────

describe("queryComponentKpiCorporateAnalyst", () => {
  it("portfolio_positions, stock_analysis_reports를 LEFT JOIN한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await queryComponentKpiCorporateAnalyst(pool);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("portfolio_positions");
    expect(sql).toContain("stock_analysis_reports");
    expect(sql).toContain("LEFT JOIN");
    expect(sql).toContain("ACTIVE");
  });

  it("rows가 비어있을 때 기본값 row를 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await queryComponentKpiCorporateAnalyst(pool);

    expect(result.total_portfolio_active).toBe(0);
    expect(result.covered_count).toBe(0);
    expect(result.coverage_rate).toBeNull();
  });

  it("DB 결과를 그대로 반환한다", async () => {
    const mockRow = {
      total_portfolio_active: 21,
      covered_count: 17,
      coverage_rate: 81.0,
    };
    mockQuery.mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 } as never);

    const result = await queryComponentKpiCorporateAnalyst(pool);

    expect(result.total_portfolio_active).toBe(21);
    expect(result.covered_count).toBe(17);
    expect(result.coverage_rate).toBe(81.0);
  });
});
