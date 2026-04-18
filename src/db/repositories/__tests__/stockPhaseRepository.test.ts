/**
 * stockPhaseRepository 단위 테스트 — findPhase2SinceDates.
 *
 * Phase 2 연속 진입 시작일 배치 조회 함수 검증.
 * DB는 mock 처리.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import { findPhase2SinceDates, queryWeeklyQaThesisOverall, findPortfolioEligibleStock } from "../stockPhaseRepository.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe("findPhase2SinceDates", () => {
  it("빈 배열 입력 시 DB 조회 없이 빈 배열 반환", async () => {
    const result = await findPhase2SinceDates([], "2026-04-10");
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("SQL에 stock_phases 테이블과 phase = 2 조건이 포함된다", async () => {
    await findPhase2SinceDates(["NVDA", "AAPL"], "2026-04-10");

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("stock_phases");
    expect(sql).toContain("phase <> 2");
    expect(sql).toContain("phase = 2");
  });

  it("symbols과 asOfDate를 파라미터로 전달한다", async () => {
    await findPhase2SinceDates(["NVDA"], "2026-04-10");

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toEqual(["NVDA"]);
    expect(params[1]).toBe("2026-04-10");
  });

  it("결과를 그대로 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { symbol: "NVDA", phase2_since: "2026-04-05" },
        { symbol: "AAPL", phase2_since: "2026-04-08" },
      ],
      rowCount: 2,
    } as never);

    const result = await findPhase2SinceDates(["NVDA", "AAPL"], "2026-04-10");
    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe("NVDA");
    expect(result[0].phase2_since).toBe("2026-04-05");
    expect(result[1].symbol).toBe("AAPL");
    expect(result[1].phase2_since).toBe("2026-04-08");
  });
});

describe("findPortfolioEligibleStock", () => {
  it("Phase 2 + RS>=60 + SEPA S/A 조건이 SQL에 포함된다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await findPortfolioEligibleStock("NVDA", "2026-04-18");

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("stock_phases");
    expect(sql).toContain("phase = 2");
    expect(sql).toContain("rs_score >= 60");
    expect(sql).toContain("grade IN ('S', 'A')");
    expect(sql).toContain("country = 'US'");
  });

  it("symbol과 date를 파라미터로 전달한다", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await findPortfolioEligibleStock("NVDA", "2026-04-18");

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("NVDA");
    expect(params[1]).toBe("2026-04-18");
  });

  it("자격이 있는 종목 데이터를 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ symbol: "NVDA", phase: 2, rs_score: 70, sepa_grade: "A", sector: "Technology", industry: "Semiconductors" }],
      rowCount: 1,
    } as never);

    const result = await findPortfolioEligibleStock("NVDA", "2026-04-18");

    expect(result).not.toBeNull();
    expect(result?.symbol).toBe("NVDA");
    expect(result?.phase).toBe(2);
    expect(result?.rs_score).toBe(70);
    expect(result?.sepa_grade).toBe("A");
  });

  it("자격 미충족 종목은 null을 반환한다 (SEPA 기록 없음 포함)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await findPortfolioEligibleStock("XYZ", "2026-04-18");

    expect(result).toBeNull();
  });
});

describe("queryWeeklyQaThesisOverall", () => {
  it("SQL에 is_status_quo IS NOT TRUE 필터가 포함된다", async () => {
    await queryWeeklyQaThesisOverall(pool as never);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("is_status_quo IS NOT TRUE");
  });

  it("결과를 그대로 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { agent_persona: "macro", confirmed: 5, invalidated: 2, expired: 1, active: 3, total: 11 },
      ],
      rowCount: 1,
    } as never);

    const result = await queryWeeklyQaThesisOverall(pool as never);
    expect(result).toHaveLength(1);
    expect(result[0].agent_persona).toBe("macro");
    expect(result[0].confirmed).toBe(5);
  });
});
