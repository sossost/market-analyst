/**
 * CANDIDATE thesis 기능 단위 테스트 (#981).
 *
 * 검증 항목:
 * 1. saveCandidateThesisFromNextBottleneck — 정상 삽입
 * 2. saveCandidateThesisFromNextBottleneck — CANDIDATE 중복 스킵
 * 3. saveCandidateThesisFromNextBottleneck — ACTIVE 중복 스킵
 * 4. expireStaleCandidateTheses — ACTIVE 승격 중복 정리
 * 5. expireStaleCandidateTheses — 30일 방치 만료
 * 6. formatCandidateThesesForPrompt — 빈 배열이면 빈 문자열 반환
 * 7. formatCandidateThesesForPrompt — 후보 섹션 헤더와 thesis 목록 포맷
 * 8. saveTheses — nextBottleneck 있는 structural_narrative thesis 저장 시 CANDIDATE 생성 호출
 * 9. saveTheses — CANDIDATE 저장 실패가 원본 thesis 저장을 방해하지 않음 (에러 격리)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 모킹 선언 — vi.mock은 호이스팅되므로 factory 내부에서 vi.fn() 정의 ─────

vi.mock("@/db/client", () => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhereSelect = vi.fn().mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhereSelect });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });

  return {
    db: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: { col, val } }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: { col, vals } }),
  or: (...args: unknown[]) => ({ or: args }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: { col, val } }),
  sql: (str: unknown) => str,
}));

vi.mock("@/db/schema/analyst", () => ({
  theses: {
    id: "id",
    status: "status",
    thesis: "thesis",
    debateDate: "debate_date",
    agentPersona: "agent_persona",
    timeframeDays: "timeframe_days",
    category: "category",
    confidence: "confidence",
    consensusLevel: "consensus_level",
    consensusScore: "consensus_score",
    verificationMetric: "verification_metric",
    targetCondition: "target_condition",
    invalidationCondition: "invalidation_condition",
    nextBottleneck: "next_bottleneck",
    dissentReason: "dissent_reason",
    minorityView: "minority_view",
    consensusUnverified: "consensus_unverified",
    contradictionDetected: "contradiction_detected",
    isStatusQuo: "is_status_quo",
    verificationDate: "verification_date",
    verificationResult: "verification_result",
    closeReason: "close_reason",
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
  recordNarrativeChain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../quantitativeVerifier.js", () => ({
  tryQuantitativeVerification: vi.fn(),
  parseQuantitativeCondition: vi.fn().mockReturnValue(null),
  formatSupportedMetricsForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("../statusQuoDetector.js", () => ({
  detectStatusQuo: vi.fn().mockReturnValue(null),
}));

vi.mock("../thesisConstants.js", () => ({
  THESIS_EXPIRE_PROGRESS: 0.5,
}));

vi.mock("@/lib/thesis-dedup", () => ({
  getDedupedCounts: vi.fn().mockReturnValue({ confirmed: 0, invalidated: 0 }),
}));

// ─── 대상 모듈 import (mock 선언 후) ──────────────────────────────────────────

import {
  saveCandidateThesisFromNextBottleneck,
  expireStaleCandidateTheses,
  formatCandidateThesesForPrompt,
  saveTheses,
} from "../thesisStore.js";
import { db } from "@/db/client";

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    thesis: "[N+1 후보] HBM 용량 제한",
    debateDate: "2026-04-24",
    agentPersona: "tech",
    status: "CANDIDATE",
    timeframeDays: 180,
    verificationMetric: "다음 토론 세션 에이전트 합의",
    targetCondition: "에이전트 2명 이상이 동일 병목을 독립적으로 제안",
    confidence: "low",
    consensusLevel: "1/4",
    consensusScore: 1,
    category: "structural_narrative",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── beforeEach 리셋 ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // db.insert 체인 기본 설정
  const insertReturning = vi.fn().mockResolvedValue([]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues });

  // db.update 체인 기본 설정
  const updateReturning = vi.fn().mockResolvedValue([]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

  // db.select 체인 기본 설정 (중복 체크용 — 기본적으로 비어있음)
  const selectLimit = vi.fn().mockResolvedValue([]);
  const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit, orderBy: selectOrderBy });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

  // db.delete 체인 기본 설정
  (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
});

// ─── saveCandidateThesisFromNextBottleneck 테스트 ─────────────────────────────

describe("saveCandidateThesisFromNextBottleneck", () => {
  it("중복이 없으면 CANDIDATE thesis를 삽입하고 ID를 반환한다", async () => {
    const insertReturning = vi.fn().mockResolvedValue([{ id: 42 }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues });

    // 중복 체크: 빈 배열 (중복 없음)
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const result = await saveCandidateThesisFromNextBottleneck({
      nextBottleneck: "HBM 용량 제한",
      sourceThesisId: 10,
      agentPersona: "tech",
      megatrend: "AI 인프라 확장",
      debateDate: "2026-04-24",
    });

    expect(result).toBe(42);
    expect(db.insert).toHaveBeenCalledTimes(1);

    const insertedValues = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues.thesis).toBe("[N+1 후보] HBM 용량 제한");
    expect(insertedValues.status).toBe("CANDIDATE");
    expect(insertedValues.confidence).toBe("low");
    expect(insertedValues.consensusLevel).toBe("1/4");
    expect(insertedValues.timeframeDays).toBe(180);
    expect(insertedValues.category).toBe("structural_narrative");
    expect(insertedValues.nextBottleneck).toBeNull();
  });

  it("동일 병목 텍스트의 CANDIDATE가 이미 존재하면 스킵하고 null을 반환한다", async () => {
    // 중복 체크: 기존 CANDIDATE 존재
    const selectLimit = vi.fn().mockResolvedValue([{ id: 7 }]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const result = await saveCandidateThesisFromNextBottleneck({
      nextBottleneck: "HBM 용량 제한",
      sourceThesisId: 10,
      agentPersona: "tech",
      megatrend: "AI 인프라 확장",
      debateDate: "2026-04-24",
    });

    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("동일 병목 텍스트의 ACTIVE thesis가 이미 존재하면 스킵하고 null을 반환한다", async () => {
    // 중복 체크: 기존 ACTIVE 존재 (이미 승격된 케이스)
    const selectLimit = vi.fn().mockResolvedValue([{ id: 15 }]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const result = await saveCandidateThesisFromNextBottleneck({
      nextBottleneck: "HBM 용량 제한",
      sourceThesisId: 10,
      agentPersona: "tech",
      megatrend: "AI 인프라 확장",
      debateDate: "2026-04-24",
    });

    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("DB 삽입 결과가 비어있으면 null을 반환한다", async () => {
    // 중복 없음
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    // insert 결과 비어있음
    const insertReturning = vi.fn().mockResolvedValue([]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues });

    const result = await saveCandidateThesisFromNextBottleneck({
      nextBottleneck: "HBM 용량 제한",
      sourceThesisId: 10,
      agentPersona: "tech",
      megatrend: "AI 인프라 확장",
      debateDate: "2026-04-24",
    });

    expect(result).toBeNull();
  });
});

// ─── expireStaleCandidateTheses 테스트 ───────────────────────────────────────

describe("expireStaleCandidateTheses", () => {
  it("ACTIVE로 승격된 동일 병목의 CANDIDATE를 EXPIRED 처리한다 (promotedCleanup)", async () => {
    const updateReturning = vi.fn()
      .mockResolvedValueOnce([{ id: 3 }])  // 1차 (promotedCleanup)
      .mockResolvedValueOnce([]);           // 2차 (timeout expire)
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    const result = await expireStaleCandidateTheses("2026-04-24");

    expect(result.promotedCleanup).toBe(1);
    expect(result.expired).toBe(0);
    expect(db.update).toHaveBeenCalledTimes(2);

    const firstSetArgs = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(firstSetArgs.status).toBe("EXPIRED");
    expect(firstSetArgs.closeReason).toBe("promoted_to_active");
  });

  it("30일 초과 CANDIDATE를 EXPIRED 처리한다 (expired)", async () => {
    const updateReturning = vi.fn()
      .mockResolvedValueOnce([])           // 1차 (promotedCleanup — 없음)
      .mockResolvedValueOnce([{ id: 5 }, { id: 6 }]); // 2차 (timeout)
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    const result = await expireStaleCandidateTheses("2026-05-25");

    expect(result.promotedCleanup).toBe(0);
    expect(result.expired).toBe(2);

    const secondSetArgs = updateSet.mock.calls[1][0] as Record<string, unknown>;
    expect(secondSetArgs.status).toBe("EXPIRED");
    expect(secondSetArgs.closeReason).toBe("candidate_timeout");
    expect(secondSetArgs.verificationResult).toContain("30일");
  });

  it("만료 대상이 없으면 promotedCleanup=0, expired=0을 반환한다", async () => {
    const updateReturning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: updateSet });

    const result = await expireStaleCandidateTheses("2026-04-24");

    expect(result.promotedCleanup).toBe(0);
    expect(result.expired).toBe(0);
  });
});

// ─── formatCandidateThesesForPrompt 테스트 ───────────────────────────────────

describe("formatCandidateThesesForPrompt", () => {
  it("빈 배열이면 빈 문자열을 반환한다", () => {
    expect(formatCandidateThesesForPrompt([])).toBe("");
  });

  it("후보 섹션 헤더가 포함된 포맷을 반환한다", () => {
    const rows = [makeCandidateRow()] as ReturnType<typeof makeCandidateRow>[];
    const result = formatCandidateThesesForPrompt(rows as any);

    expect(result).toContain("[후보 thesis — 다음 토론 검증 대상]");
    expect(result).toContain("[N+1 후보] HBM 용량 제한");
    expect(result).toContain("2026-04-24");
    expect(result).toContain("테크 애널리스트");
  });

  it("복수의 CANDIDATE thesis를 모두 포함한다", () => {
    const rows = [
      makeCandidateRow({ id: 1, thesis: "[N+1 후보] HBM 용량 제한", agentPersona: "tech" }),
      makeCandidateRow({ id: 2, thesis: "[N+1 후보] 전력 인프라 부족", agentPersona: "macro" }),
    ] as any;

    const result = formatCandidateThesesForPrompt(rows);

    expect(result).toContain("[N+1 후보] HBM 용량 제한");
    expect(result).toContain("[N+1 후보] 전력 인프라 부족");
    expect(result).toContain("테크 애널리스트");
    expect(result).toContain("매크로 이코노미스트");
  });
});

// ─── saveTheses 후처리 연결 테스트 ───────────────────────────────────────────

describe("saveTheses — CANDIDATE 후처리", () => {
  it("nextBottleneck이 있는 structural_narrative thesis 저장 시 CANDIDATE thesis 생성을 시도한다", async () => {
    // saveTheses 내부의 insert (theses 저장)
    const insertReturning = vi.fn().mockResolvedValue([{ id: 100 }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues });

    // enforceActiveThesisCap용 select (중복 방지 체크 + cap 체크)
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectWhere = vi.fn().mockReturnValue({
      limit: selectLimit,
      orderBy: selectOrderBy,
      groupBy: vi.fn().mockResolvedValue([]),
    });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const thesis = {
      agentPersona: "tech" as const,
      thesis: "AI 반도체 광트랜시버 병목 지속",
      timeframeDays: 90 as const,
      verificationMetric: "Technology RS",
      targetCondition: "Technology RS > 60",
      confidence: "medium" as const,
      consensusLevel: "2/4" as const,
      category: "structural_narrative" as const,
      nextBottleneck: "HBM 용량 제한 — 광트랜시버 병목 해소 후 (추론 기반, 미확인)",
      narrativeChain: {
        megatrend: "AI 인프라 확장",
        demandDriver: "AI 모델 파라미터 증가",
        supplyChain: "광트랜시버 → 광케이블",
        bottleneck: "광트랜시버 대역폭 제한",
      },
    };

    await saveTheses("2026-04-24", [thesis]);

    // insert가 2번 호출되어야 함: 원본 thesis + CANDIDATE thesis
    // (중복 체크에서 비어있으므로 CANDIDATE 삽입으로 진행)
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("CANDIDATE thesis 저장 실패가 원본 thesis 저장을 방해하지 않는다 (에러 격리)", async () => {
    // 원본 thesis 저장 성공
    const insertReturning = vi.fn().mockResolvedValue([{ id: 200 }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ values: insertValues }) // 원본 thesis 저장
      .mockImplementationOnce(() => {                 // CANDIDATE 저장 — 실패
        throw new Error("DB 연결 오류");
      });

    // select 체인: enforceActiveThesisCap용 groupBy 포함
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectGroupBy = vi.fn().mockResolvedValue([]); // enforceActiveThesisCap
    const selectWhere = vi.fn().mockReturnValue({
      limit: selectLimit,
      orderBy: selectOrderBy,
      groupBy: selectGroupBy,
    });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const thesis = {
      agentPersona: "tech" as const,
      thesis: "AI 반도체 병목",
      timeframeDays: 90 as const,
      verificationMetric: "Technology RS",
      targetCondition: "Technology RS > 60",
      confidence: "medium" as const,
      consensusLevel: "2/4" as const,
      category: "structural_narrative" as const,
      nextBottleneck: "HBM 용량 제한",
    };

    // saveTheses가 에러를 throw하지 않아야 함 (에러 격리)
    await expect(saveTheses("2026-04-24", [thesis])).resolves.not.toThrow();
  });

  it("nextBottleneck이 없는 thesis는 CANDIDATE 생성을 시도하지 않는다", async () => {
    const insertReturning = vi.fn().mockResolvedValue([{ id: 300 }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: insertValues });

    // select 체인: enforceActiveThesisCap용 groupBy 포함
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectGroupBy = vi.fn().mockResolvedValue([]);
    const selectWhere = vi.fn().mockReturnValue({
      limit: selectLimit,
      orderBy: selectOrderBy,
      groupBy: selectGroupBy,
    });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: selectFrom });

    const thesis = {
      agentPersona: "tech" as const,
      thesis: "AI 반도체 병목",
      timeframeDays: 90 as const,
      verificationMetric: "Technology RS",
      targetCondition: "Technology RS > 60",
      confidence: "medium" as const,
      consensusLevel: "2/4" as const,
      category: "structural_narrative" as const,
      nextBottleneck: null,
    };

    await saveTheses("2026-04-24", [thesis]);

    // insert는 원본 thesis 1번만 호출되어야 함
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
