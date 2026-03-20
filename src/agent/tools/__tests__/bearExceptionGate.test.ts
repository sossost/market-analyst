import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bear Exception Gate 단위 테스트.
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

vi.mock("@/agent/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- import (mock 이후) ---

import {
  evaluateBearException,
  tagBearExceptionReason,
  BEAR_EXCEPTION_TAG,
  BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS,
  BEAR_EXCEPTION_SECTOR_RS_PERCENTILE,
  BEAR_EXCEPTION_MIN_GRADE,
} from "../bearExceptionGate";
import { pool } from "@/db/client";
import { logger } from "@/agent/logger";

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

describe("Bear Exception Gate 상수", () => {
  it("Phase 2 지속성 기준은 5일이다", () => {
    expect(BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS).toBe(5);
  });

  it("섹터 RS 퍼센타일 기준은 상위 5%이다", () => {
    expect(BEAR_EXCEPTION_SECTOR_RS_PERCENTILE).toBe(5);
  });

  it("최소 SEPA 등급은 S이다", () => {
    expect(BEAR_EXCEPTION_MIN_GRADE).toBe("S");
  });
});

// =============================================================================
// evaluateBearException — 3조건 모두 충족 시 통과
// =============================================================================

describe("evaluateBearException", () => {
  function setupAllPassMocks() {
    // 1. 섹터 RS: rank 1 / total 20 → 5%
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    // 2. 펀더멘탈: S등급
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    // 3. Phase 2 지속성: 5일
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });
  }

  it("3조건 모두 충족하면 passed: true를 반환한다", async () => {
    setupAllPassMocks();

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
    expect(result.details.sectorRsRank).toBe(1);
    expect(result.details.totalSectors).toBe(20);
    expect(result.details.sectorRsPercentile).toBe(5);
    expect(result.details.fundamentalGrade).toBe("S");
    expect(result.details.phase2Count).toBe(5);
    expect(result.reason).toContain("Bear 예외 통과");
  });

  it("섹터 RS가 상위 5% 초과면 passed: false를 반환한다", async () => {
    // rank 3 / total 20 → 15% (5% 초과)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "3", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.sectorRsPercentile).toBe(15);
    expect(result.reason).toContain("섹터RS 15%");
  });

  it("펀더멘탈이 S등급이 아니면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    // A등급 — S 미만
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.fundamentalGrade).toBe("A");
    expect(result.reason).toContain("SEPA A");
  });

  it("Phase 2 지속성이 5일 미만이면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    // 4일 — 5일 미만
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "4" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.phase2Count).toBe(4);
    expect(result.reason).toContain("Phase2 지속 4일");
  });

  it("3조건 모두 실패하면 3개 실패 사유를 모두 포함한다", async () => {
    // 섹터 RS: rank 10 / total 20 → 50%
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "10", total_sectors: "20" }],
    });
    // F등급
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "F" }],
    });
    // 0일
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "0" }],
    });

    const result = await evaluateBearException({
      symbol: "WEAK",
      sector: "Consumer Discretionary",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("섹터RS");
    expect(result.reason).toContain("SEPA");
    expect(result.reason).toContain("Phase2");
  });

  it("섹터 RS 데이터가 없으면 fail-closed (passed: false)", async () => {
    // 섹터 RS: 없음
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.sectorRsRank).toBeNull();
    expect(result.details.sectorRsPercentile).toBeNull();
  });

  it("펀더멘탈 데이터가 없으면 fail-closed (passed: false)", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    // 등급 없음
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateBearException({
      symbol: "NEW",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.fundamentalGrade).toBeNull();
  });

  it("DB 에러 시 fail-closed (passed: false)", async () => {
    mockPool.query.mockRejectedValueOnce(new Error("DB 연결 실패"));
    mockPool.query.mockRejectedValueOnce(new Error("DB 연결 실패"));
    mockPool.query.mockRejectedValueOnce(new Error("DB 연결 실패"));

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("섹터 RS rank 1/20 = 5% 는 경계값으로 통과한다", async () => {
    // rank 1 / total 20 → 5% (정확히 경계)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "6" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
    expect(result.details.sectorRsPercentile).toBe(5);
  });

  it("섹터 RS rank 2/20 = 10% 는 경계값 초과로 실패한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "2", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.sectorRsPercentile).toBe(10);
  });
});

// =============================================================================
// tagBearExceptionReason 단위 테스트
// =============================================================================

describe("tagBearExceptionReason", () => {
  it("reason에 [Bear 예외] 접두사를 추가한다", () => {
    const result = tagBearExceptionReason("강한 RS 모멘텀");
    expect(result).toBe("[Bear 예외] 강한 RS 모멘텀");
  });

  it("이미 [Bear 예외] 태그가 있으면 중복 추가하지 않는다", () => {
    const result = tagBearExceptionReason("[Bear 예외] 기존 사유");
    expect(result).toBe("[Bear 예외] 기존 사유");
  });

  it("null을 받으면 [Bear 예외] 태그만 반환한다", () => {
    const result = tagBearExceptionReason(null);
    expect(result).toBe("[Bear 예외]");
  });

  it("빈 문자열을 받으면 [Bear 예외] 태그만 반환한다", () => {
    const result = tagBearExceptionReason("");
    expect(result).toBe("[Bear 예외]");
  });
});
