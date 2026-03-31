/**
 * enforceActiveThesisCap 단위 테스트.
 *
 * 검증 항목:
 * 1. 전체 에이전트가 상한 이하 → 만료 없음
 * 2. 단일 에이전트가 상한 초과 → 초과분만 EXPIRED
 * 3. 복수 에이전트 중 초과 에이전트만 영향
 * 4. 정확히 상한 = 만료 없음
 * 5. 상수 MAX_ACTIVE_THESES_PER_AGENT 값 검증
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 모킹 선언 ─────────────────────────────────────────────────────────────────

vi.mock("@/db/client", () => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: { col, val } }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: { col, vals } }),
  sql: (str: unknown) => str,
  asc: (col: unknown) => ({ asc: col }),
}));

vi.mock("@/db/schema/analyst", () => ({
  theses: {
    id: "id",
    status: "status",
    agentPersona: "agent_persona",
    debateDate: "debate_date",
    timeframeDays: "timeframe_days",
    verificationDate: "verification_date",
    closeReason: "close_reason",
    verificationResult: "verification_result",
    verificationMethod: "verification_method",
    createdAt: "created_at",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../narrativeChainService.js", () => ({
  recordNarrativeChain: vi.fn(),
}));

vi.mock("../quantitativeVerifier.js", () => ({
  tryQuantitativeVerification: vi.fn(),
  parseQuantitativeCondition: vi.fn(),
}));

// ─── 대상 모듈 import (mock 선언 후) ──────────────────────────────────────────

import { enforceActiveThesisCap, MAX_ACTIVE_THESES_PER_AGENT } from "../thesisStore.js";
import { db } from "@/db/client";

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────────

function setupDbChain(options: {
  groupByResult: Array<{ agentPersona: string; count: number }>;
  oldestIds?: number[];
  expiredIds?: number[];
}) {
  // select chain 호출 횟수 추적
  let selectCallCount = 0;

  const mockSelect = db.select as ReturnType<typeof vi.fn>;

  mockSelect.mockImplementation(() => {
    selectCallCount++;
    const callNum = selectCallCount;

    if (callNum === 1) {
      // 첫 번째 호출: groupBy 카운트 조회
      const mockGroupBy = vi.fn().mockResolvedValue(options.groupByResult);
      const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      return { from: mockFrom };
    }

    // 이후 호출: 가장 오래된 thesis 조회
    const ids = options.oldestIds ?? [];
    const mockLimit = vi.fn().mockResolvedValue(ids.map((id) => ({ id })));
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    return { from: mockFrom };
  });

  // update chain
  const expiredResult = (options.expiredIds ?? []).map((id) => ({ id }));
  const mockReturning = vi.fn().mockResolvedValue(expiredResult);
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockUpdateSet });

  return { mockUpdateSet, mockUpdateWhere, mockReturning };
}

// ─── beforeEach ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 테스트 ─────────────────────────────────────────────────────────────────────

describe("enforceActiveThesisCap", () => {
  it("MAX_ACTIVE_THESES_PER_AGENT는 10이다", () => {
    expect(MAX_ACTIVE_THESES_PER_AGENT).toBe(10);
  });

  it("전체 에이전트가 상한 이하이면 만료 없이 0을 반환한다", async () => {
    setupDbChain({
      groupByResult: [
        { agentPersona: "tech", count: 8 },
        { agentPersona: "macro", count: 5 },
        { agentPersona: "sentiment", count: 3 },
      ],
    });

    const result = await enforceActiveThesisCap("2026-03-31");

    expect(result).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("정확히 상한(10건)이면 만료 없이 0을 반환한다", async () => {
    setupDbChain({
      groupByResult: [
        { agentPersona: "tech", count: 10 },
      ],
    });

    const result = await enforceActiveThesisCap("2026-03-31");

    expect(result).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("상한 초과 에이전트의 가장 오래된 thesis를 EXPIRED 처리한다", async () => {
    const { mockUpdateSet } = setupDbChain({
      groupByResult: [
        { agentPersona: "tech", count: 13 },
      ],
      oldestIds: [1, 2, 3],
      expiredIds: [1, 2, 3],
    });

    const result = await enforceActiveThesisCap("2026-03-31");

    expect(result).toBe(3);
    expect(db.update).toHaveBeenCalledTimes(1);

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("EXPIRED");
    expect(setArgs.closeReason).toBe("cap_exceeded");
    expect(setArgs.verificationDate).toBe("2026-03-31");
    expect(setArgs.verificationResult).toContain("ACTIVE 상한 초과");
  });

  it("복수 에이전트 중 초과 에이전트만 영향을 받는다", async () => {
    let selectCallCount = 0;
    const mockSelect = db.select as ReturnType<typeof vi.fn>;

    mockSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // groupBy 카운트
        const mockGroupBy = vi.fn().mockResolvedValue([
          { agentPersona: "tech", count: 16 },
          { agentPersona: "macro", count: 5 },
          { agentPersona: "sentiment", count: 10 },
        ]);
        const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
        const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
        return { from: mockFrom };
      }
      // tech만 초과 → oldest 조회 1회
      const mockLimit = vi.fn().mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }, { id: 15 }]);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      return { from: mockFrom };
    });

    const mockReturning = vi.fn().mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }, { id: 15 }]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockUpdateSet });

    const result = await enforceActiveThesisCap("2026-03-31");

    // tech만 6건 초과 → 6건 만료
    expect(result).toBe(6);
    // update는 tech에 대해서만 1회 호출 (macro/sentiment는 상한 이하)
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("ACTIVE thesis가 없으면 0을 반환한다", async () => {
    setupDbChain({
      groupByResult: [],
    });

    const result = await enforceActiveThesisCap("2026-03-31");

    expect(result).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });
});
