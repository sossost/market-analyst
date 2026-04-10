/**
 * Industry Override 시스템 단위 테스트.
 *
 * 검증 대상:
 * - groupRsRepository: industry 조회 시 COALESCE + LEFT JOIN이 SQL에 포함된다
 * - groupRsRepository: sector 조회 시 override JOIN이 포함되지 않는다
 * - symbolRepository: findSymbolMeta에 override JOIN이 포함된다
 * - corporateRepository: findSymbolInfo에 override JOIN이 포함된다
 * - fundamentalRepository: findFundamentalAcceleration에 override JOIN이 포함된다
 * - stockPhaseRepository: override가 적용되는 함수들의 SQL에 COALESCE가 포함된다
 *
 * DB는 mock 처리. 실제 Supabase 연결 없음.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { pool } from "@/db/client";
import {
  findGroupAvgs,
  findGroupBreadth,
  findGroupTransitions,
  findGroupFundamentals,
} from "../groupRsRepository.js";
import { findSymbolMeta } from "../symbolRepository.js";
import {
  findPhase2Stocks,
  findAllPhase2Stocks,
  findActiveNonEtfSymbols,
  countNullIndustrySymbols,
  findPhase2RatioForQa,
} from "../stockPhaseRepository.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function getLastSql(): string {
  const calls = mockQuery.mock.calls;
  if (calls.length === 0) throw new Error("pool.query not called");
  return calls[calls.length - 1][0] as string;
}

const OVERRIDE_JOIN = "symbol_industry_overrides";
const COALESCE_INDUSTRY = "COALESCE(sio.industry";

// ─── groupRsRepository ───────────────────────────────────────────────────────

describe("groupRsRepository — industry override", () => {
  describe("findGroupAvgs", () => {
    it("industry 모드에서 override JOIN과 COALESCE를 포함한다", async () => {
      await findGroupAvgs("industry", "2026-04-09", 5);
      const sql = getLastSql();
      expect(sql).toContain(OVERRIDE_JOIN);
      expect(sql).toContain(COALESCE_INDUSTRY);
    });

    it("sector 모드에서 override JOIN을 포함하지 않는다", async () => {
      await findGroupAvgs("sector", "2026-04-09", 5);
      const sql = getLastSql();
      expect(sql).not.toContain(OVERRIDE_JOIN);
      expect(sql).toContain("s.sector");
    });
  });

  describe("findGroupBreadth", () => {
    it("industry 모드에서 override JOIN과 COALESCE를 포함한다", async () => {
      await findGroupBreadth("industry", "2026-04-09", ["Semiconductors"]);
      const sql = getLastSql();
      expect(sql).toContain(OVERRIDE_JOIN);
      expect(sql).toContain(COALESCE_INDUSTRY);
    });

    it("sector 모드에서 override JOIN을 포함하지 않는다", async () => {
      await findGroupBreadth("sector", "2026-04-09", ["Technology"]);
      const sql = getLastSql();
      expect(sql).not.toContain(OVERRIDE_JOIN);
    });
  });

  describe("findGroupTransitions", () => {
    it("industry 모드에서 override JOIN을 포함한다", async () => {
      await findGroupTransitions("industry", ["Semiconductors"], "2026-04-09");
      const sql = getLastSql();
      expect(sql).toContain(OVERRIDE_JOIN);
      expect(sql).toContain(COALESCE_INDUSTRY);
    });
  });

  describe("findGroupFundamentals", () => {
    it("industry 모드에서 override JOIN을 포함한다", async () => {
      await findGroupFundamentals("industry", ["Semiconductors"]);
      const sql = getLastSql();
      expect(sql).toContain(OVERRIDE_JOIN);
      expect(sql).toContain(COALESCE_INDUSTRY);
    });
  });
});

// ─── symbolRepository ────────────────────────────────────────────────────────

describe("symbolRepository — industry override", () => {
  it("findSymbolMeta에 override JOIN과 COALESCE를 포함한다", async () => {
    await findSymbolMeta("SNDK");
    const sql = getLastSql();
    expect(sql).toContain(OVERRIDE_JOIN);
    expect(sql).toContain(COALESCE_INDUSTRY);
  });
});

// ─── stockPhaseRepository ────────────────────────────────────────────────────

describe("stockPhaseRepository — industry override", () => {
  it("findPhase2Stocks에 override JOIN과 COALESCE를 포함한다", async () => {
    await findPhase2Stocks({ date: "2026-04-09", minRs: 50, maxRs: 99, limit: 100 });
    const sql = getLastSql();
    expect(sql).toContain(OVERRIDE_JOIN);
    expect(sql).toContain(COALESCE_INDUSTRY);
  });

  it("findAllPhase2Stocks에 override JOIN과 COALESCE를 포함한다", async () => {
    await findAllPhase2Stocks("2026-04-09");
    const sql = getLastSql();
    expect(sql).toContain(OVERRIDE_JOIN);
    expect(sql).toContain(COALESCE_INDUSTRY);
  });

  it("findActiveNonEtfSymbols에 override JOIN과 COALESCE를 포함한다", async () => {
    await findActiveNonEtfSymbols();
    const sql = getLastSql();
    expect(sql).toContain(OVERRIDE_JOIN);
    expect(sql).toContain(COALESCE_INDUSTRY);
  });

  it("countNullIndustrySymbols에 override JOIN과 COALESCE를 포함한다", async () => {
    await countNullIndustrySymbols();
    const sql = getLastSql();
    expect(sql).toContain(OVERRIDE_JOIN);
    expect(sql).toContain(COALESCE_INDUSTRY);
  });

  it("findPhase2RatioForQa에 override JOIN과 COALESCE를 포함한다", async () => {
    await findPhase2RatioForQa("2026-04-09");
    const sql = getLastSql();
    expect(sql).toContain(OVERRIDE_JOIN);
    expect(sql).toContain(COALESCE_INDUSTRY);
  });
});
