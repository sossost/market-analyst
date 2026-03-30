import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Late Bull Gate 단위 테스트.
 *
 * 외부 의존성(DB, pool)은 모두 mock 처리.
 */

// --- 모듈 mock 설정 ---

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- import (mock 이후) ---

import {
  evaluateLateBullGate,
  tagLateBullReason,
  LATE_BULL_TAG,
  LATE_BULL_MIN_RS,
  LATE_BULL_ALLOWED_GRADES,
  LATE_BULL_PHASE2_PERSISTENCE_DAYS,
} from "../lateBullGate";
import { pool } from "@/db/client";
import { logger } from "@/lib/logger";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockLogger = logger as unknown as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// 상수 검증
// =============================================================================

describe("Late Bull Gate 상수", () => {
  it("최소 RS 기준은 70이다", () => {
    expect(LATE_BULL_MIN_RS).toBe(70);
  });

  it("허용 SEPA 등급은 S와 A이다", () => {
    expect(LATE_BULL_ALLOWED_GRADES.has("S")).toBe(true);
    expect(LATE_BULL_ALLOWED_GRADES.has("A")).toBe(true);
    expect(LATE_BULL_ALLOWED_GRADES.has("B")).toBe(false);
  });

  it("Phase 2 지속성 기준은 5일이다", () => {
    expect(LATE_BULL_PHASE2_PERSISTENCE_DAYS).toBe(5);
  });
});

// =============================================================================
// evaluateLateBullGate — 3조건 모두 충족 시 통과
// =============================================================================

describe("evaluateLateBullGate", () => {
  function setupAllPassMocks() {
    // 1. 펀더멘탈: A등급
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    // 2. Phase 2 지속성: 5일
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });
  }

  it("3조건 모두 충족하면 passed: true를 반환한다", async () => {
    setupAllPassMocks();

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 75,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
    expect(result.details.rsScore).toBe(75);
    expect(result.details.fundamentalGrade).toBe("A");
    expect(result.details.phase2Count).toBe(5);
    expect(result.reason).toContain("Late Bull 감쇠 통과");
  });

  it("S등급도 통과한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "6" }],
    });

    const result = await evaluateLateBullGate({
      symbol: "LMT",
      rsScore: 85,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
    expect(result.details.fundamentalGrade).toBe("S");
  });

  it("RS가 70 미만이면 passed: false를 반환한다", async () => {
    setupAllPassMocks();

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 65,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("RS 65");
    expect(result.reason).toContain("기준: ≥70");
  });

  it("RS 70은 경계값으로 통과한다", async () => {
    setupAllPassMocks();

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 70,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
  });

  it("RS 69는 경계값으로 실패한다", async () => {
    setupAllPassMocks();

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 69,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("RS 69");
  });

  it("펀더멘탈이 B등급이면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "B" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 80,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.fundamentalGrade).toBe("B");
    expect(result.reason).toContain("SEPA B");
  });

  it("펀더멘탈이 C등급이면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "C" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 80,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("SEPA C");
  });

  it("Phase 2 지속성이 5일 미만이면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "4" }],
    });

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 80,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.phase2Count).toBe(4);
    expect(result.reason).toContain("Phase2 지속 4일");
  });

  it("3조건 모두 실패하면 3개 실패 사유를 모두 포함한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "F" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "0" }],
    });

    const result = await evaluateLateBullGate({
      symbol: "WEAK",
      rsScore: 50,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("RS 50");
    expect(result.reason).toContain("SEPA");
    expect(result.reason).toContain("Phase2");
  });

  it("펀더멘탈 데이터가 없으면 fail-closed (passed: false)", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateLateBullGate({
      symbol: "NEW",
      rsScore: 80,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.fundamentalGrade).toBeNull();
  });

  it("DB 에러 시 fail-closed (passed: false)", async () => {
    mockPool.query.mockRejectedValueOnce(new Error("DB 연결 실패"));
    mockPool.query.mockRejectedValueOnce(new Error("DB 연결 실패"));

    const result = await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 80,
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("통과 시 info 로그를 남긴다", async () => {
    setupAllPassMocks();

    await evaluateLateBullGate({
      symbol: "AAPL",
      rsScore: 80,
      date: "2026-03-10",
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      "LateBullGate",
      expect.stringContaining("AAPL"),
    );
  });
});

// =============================================================================
// tagLateBullReason 단위 테스트
// =============================================================================

describe("tagLateBullReason", () => {
  it("reason에 [Late Bull 감쇠] 접두사를 추가한다", () => {
    const result = tagLateBullReason("강한 RS 모멘텀");
    expect(result).toBe("[Late Bull 감쇠] 강한 RS 모멘텀");
  });

  it("이미 [Late Bull 감쇠] 태그가 있으면 중복 추가하지 않는다", () => {
    const result = tagLateBullReason("[Late Bull 감쇠] 기존 사유");
    expect(result).toBe("[Late Bull 감쇠] 기존 사유");
  });

  it("null을 받으면 [Late Bull 감쇠] 태그만 반환한다", () => {
    const result = tagLateBullReason(null);
    expect(result).toBe("[Late Bull 감쇠]");
  });

  it("빈 문자열을 받으면 [Late Bull 감쇠] 태그만 반환한다", () => {
    const result = tagLateBullReason("");
    expect(result).toBe("[Late Bull 감쇠]");
  });
});
