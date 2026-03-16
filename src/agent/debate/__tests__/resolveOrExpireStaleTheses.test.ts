/**
 * resolveOrExpireStaleTheses 단위 테스트.
 *
 * 검증 항목:
 * 1. stale thesis 없음 → resolved=0, expired=0 반환
 * 2. snapshot 없음 → 모두 EXPIRED 처리
 * 3. timeframe 초과 + 정량 판정 CONFIRMED → CONFIRMED 처리
 * 4. timeframe 초과 + 정량 판정 INVALIDATED → INVALIDATED 처리
 * 5. timeframe 초과 + 정량 판정 불가(null) → EXPIRED 처리
 * 6. 혼합: 정량 판정 가능 1건 + 불가 1건 → resolved=1, expired=1
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 모킹 선언 — vi.mock은 호이스팅되므로 factory 내부에서 vi.fn() 정의 ─────

vi.mock("../../../db/client.js", () => {
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelectWhere = vi.fn().mockResolvedValue([]);
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
  sql: (str: unknown) => str,
}));

vi.mock("../../../db/schema/analyst.js", () => ({
  theses: {
    id: "id",
    status: "status",
    debateDate: "debate_date",
    timeframeDays: "timeframe_days",
    verificationDate: "verification_date",
    closeReason: "close_reason",
    verificationResult: "verification_result",
    verificationMethod: "verification_method",
  },
}));

vi.mock("../../logger.js", () => ({
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
}));

// ─── 대상 모듈 import (mock 선언 후) ──────────────────────────────────────────

import { resolveOrExpireStaleTheses } from "../thesisStore.js";
import { db } from "../../../db/client.js";
import { tryQuantitativeVerification } from "../quantitativeVerifier.js";
import type { MarketSnapshot } from "../marketDataLoader.js";

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

function makeStaleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    thesis: "테크 섹터 RS가 75 이상 유지",
    agentPersona: "tech",
    timeframeDays: 30,
    verificationMetric: "Tech RS",
    targetCondition: "Tech RS >= 75",
    invalidationCondition: "Tech RS < 60",
    confidence: "medium",
    consensusLevel: "3/4",
    ...overrides,
  };
}

function makeSnapshot(): MarketSnapshot {
  return {
    date: "2026-03-16",
    indices: [],
    sectors: [
      { sector: "Tech", avgRs: 80, phase: 2, phase2Count: 5 },
    ],
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: { phase1: 5, phase2: 10, phase3: 8, phase4: 3, total: 26 },
    fearGreed: null,
  } as unknown as MarketSnapshot;
}

// ─── beforeEach 리셋 ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // db 체인 재설정
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });
});

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("resolveOrExpireStaleTheses", () => {
  it("stale thesis가 없으면 resolved=0, expired=0을 반환한다", async () => {
    const selectWhere = vi.fn().mockResolvedValue([]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const result = await resolveOrExpireStaleTheses("2026-03-16");

    expect(result).toEqual({ resolved: 0, expired: 0 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("snapshot이 없으면 stale thesis를 배치 UPDATE로 모두 EXPIRED 처리한다", async () => {
    const rows = [makeStaleRow({ id: 1 }), makeStaleRow({ id: 2 })];

    const selectWhere = vi.fn().mockResolvedValue(rows);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    // expireStaleTheses 내부의 returning({ id }) 체인까지 지원
    const updateReturning = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    const result = await resolveOrExpireStaleTheses("2026-03-16", undefined);

    // snapshot 없음 → expireStaleTheses 1회 배치 UPDATE (N+1 아님)
    expect(result).toEqual({ resolved: 0, expired: 2 });
    expect(db.update).toHaveBeenCalledTimes(1);

    const setArgs = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("EXPIRED");
    expect(setArgs.closeReason).toBe("timeframe_exceeded");
  });

  it("정량 판정 CONFIRMED → CONFIRMED 처리, resolved=1", async () => {
    const row = makeStaleRow({ id: 42 });
    const selectWhere = vi.fn().mockResolvedValue([row]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    (tryQuantitativeVerification as ReturnType<typeof vi.fn>).mockReturnValue({
      verdict: "CONFIRMED",
      reason: "목표 조건 충족: Tech RS >= 75 (실제값: 80)",
      method: "quantitative",
    });

    const result = await resolveOrExpireStaleTheses("2026-03-16", makeSnapshot());

    expect(result).toEqual({ resolved: 1, expired: 0 });
    expect(db.update).toHaveBeenCalledTimes(1);

    const setArgs = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("CONFIRMED");
    expect(setArgs.verificationMethod).toBe("quantitative");
    expect(setArgs.closeReason).toBe("condition_met");
    expect(setArgs.verificationDate).toBe("2026-03-16");
  });

  it("정량 판정 INVALIDATED → INVALIDATED 처리, resolved=1", async () => {
    const row = makeStaleRow({ id: 99 });
    const selectWhere = vi.fn().mockResolvedValue([row]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    (tryQuantitativeVerification as ReturnType<typeof vi.fn>).mockReturnValue({
      verdict: "INVALIDATED",
      reason: "무효화 조건 충족: Tech RS < 60 (실제값: 55)",
      method: "quantitative",
    });

    const result = await resolveOrExpireStaleTheses("2026-03-16", makeSnapshot());

    expect(result).toEqual({ resolved: 1, expired: 0 });

    const setArgs = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("INVALIDATED");
    expect(setArgs.verificationMethod).toBe("quantitative");
    expect(setArgs.closeReason).toBe("condition_failed");
  });

  it("정량 판정 불가(null) → EXPIRED 처리, expired=1", async () => {
    const row = makeStaleRow({ id: 7 });
    const selectWhere = vi.fn().mockResolvedValue([row]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    (tryQuantitativeVerification as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = await resolveOrExpireStaleTheses("2026-03-16", makeSnapshot());

    expect(result).toEqual({ resolved: 0, expired: 1 });

    const setArgs = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("EXPIRED");
    expect(setArgs.closeReason).toBe("timeframe_exceeded");
  });

  it("혼합: 정량 판정 가능 1건 + 불가 1건 → resolved=1, expired=1", async () => {
    const rows = [makeStaleRow({ id: 10 }), makeStaleRow({ id: 20 })];

    const selectWhere = vi.fn().mockResolvedValue(rows);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    (tryQuantitativeVerification as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        verdict: "CONFIRMED",
        reason: "목표 조건 충족",
        method: "quantitative",
      })
      .mockReturnValueOnce(null);

    const result = await resolveOrExpireStaleTheses("2026-03-16", makeSnapshot());

    expect(result).toEqual({ resolved: 1, expired: 1 });
    expect(db.update).toHaveBeenCalledTimes(2);

    const firstSetArgs = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(firstSetArgs.status).toBe("CONFIRMED");

    const secondSetArgs = updateSet.mock.calls[1][0] as Record<string, unknown>;
    expect(secondSetArgs.status).toBe("EXPIRED");

    // 각 UPDATE가 올바른 row.id를 WHERE로 전달했는지 검증
    // WHERE 절: and(eq(theses.id, row.id), eq(theses.status, "ACTIVE"))
    // mock 구조: { and: [{ eq: { col, val } }, ...] }
    type WhereArg = { and: Array<{ eq: { col: unknown; val: unknown } }> };

    const firstWhereArg = updateWhere.mock.calls[0][0] as WhereArg;
    expect(firstWhereArg.and[0].eq.val).toBe(10);

    const secondWhereArg = updateWhere.mock.calls[1][0] as WhereArg;
    expect(secondWhereArg.and[0].eq.val).toBe(20);
  });

  it("tryQuantitativeVerification에 올바른 thesis 필드가 전달된다", async () => {
    const row = makeStaleRow({
      id: 5,
      agentPersona: "macro",
      consensusLevel: "4/4",
      targetCondition: "S&P 500 > 5800",
      invalidationCondition: "S&P 500 < 5500",
    });

    const selectWhere = vi.fn().mockResolvedValue([row]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    (tryQuantitativeVerification as ReturnType<typeof vi.fn>).mockReturnValue(null);

    await resolveOrExpireStaleTheses("2026-03-16", makeSnapshot());

    const passedThesis = (tryQuantitativeVerification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(passedThesis.agentPersona).toBe("macro");
    expect(passedThesis.consensusLevel).toBe("4/4");
    expect(passedThesis.targetCondition).toBe("S&P 500 > 5800");
    expect(passedThesis.invalidationCondition).toBe("S&P 500 < 5500");
  });
});
