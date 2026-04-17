/**
 * groupRsRepository 단위 테스트 — Shell Companies 필터 검증.
 *
 * findGroupAvgs, findGroupBreadth, findGroupFundamentals 쿼리에
 * Shell Companies 제외 조건이 포함되는지 확인한다.
 * DB는 mock 처리.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import { SHELL_COMPANIES_INDUSTRY } from "@/lib/constants";
import {
  findGroupAvgs,
  findGroupBreadth,
  findGroupFundamentals,
} from "../groupRsRepository.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe("findGroupAvgs", () => {
  it("sector 모드에서 Shell Companies 제외 필터가 포함된다", async () => {
    await findGroupAvgs("sector", "2026-04-10", 5);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain(SHELL_COMPANIES_INDUSTRY);
    expect(sql).toContain("COALESCE(sio.industry, s.industry) IS DISTINCT FROM");
  });

  it("industry 모드에서 COALESCE 기반 Shell Companies 제외 필터가 포함된다", async () => {
    await findGroupAvgs("industry", "2026-04-10", 5);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain(SHELL_COMPANIES_INDUSTRY);
    expect(sql).toContain("COALESCE(sio.industry, s.industry) IS DISTINCT FROM");
  });

  it("파라미터를 올바르게 전달한다", async () => {
    await findGroupAvgs("sector", "2026-04-10", 5);

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("2026-04-10");
    expect(params[1]).toBe(5);
  });

  it("결과를 그대로 반환한다", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ group_name: "Technology", avg_rs: "75.50", stock_count: "120" }],
      rowCount: 1,
    } as never);

    const result = await findGroupAvgs("sector", "2026-04-10", 5);
    expect(result).toHaveLength(1);
    expect(result[0].group_name).toBe("Technology");
  });
});

describe("findGroupBreadth", () => {
  it("sector 모드에서 Shell Companies 제외 필터가 포함된다", async () => {
    await findGroupBreadth("sector", "2026-04-10", ["Technology"]);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain(SHELL_COMPANIES_INDUSTRY);
  });

  it("industry 모드에서 COALESCE 기반 Shell Companies 제외 필터가 포함된다", async () => {
    await findGroupBreadth("industry", "2026-04-10", ["Semiconductors"]);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("COALESCE(sio.industry, s.industry) IS DISTINCT FROM");
    expect(sql).toContain(SHELL_COMPANIES_INDUSTRY);
  });
});

describe("findGroupFundamentals", () => {
  it("sector 모드에서 Shell Companies 제외 필터가 포함된다", async () => {
    await findGroupFundamentals("sector", ["Technology"]);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain(SHELL_COMPANIES_INDUSTRY);
  });

  it("industry 모드에서 COALESCE 기반 Shell Companies 제외 필터가 포함된다", async () => {
    await findGroupFundamentals("industry", ["Semiconductors"]);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("COALESCE(sio.industry, s.industry) IS DISTINCT FROM");
    expect(sql).toContain(SHELL_COMPANIES_INDUSTRY);
  });
});
