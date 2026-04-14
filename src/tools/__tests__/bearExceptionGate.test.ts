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

vi.mock("@/lib/logger", () => ({
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
  BEAR_EXCEPTION_RS_TOP_TIER_THRESHOLD,
  BEAR_EXCEPTION_ALLOWED_GRADES,
  EARLY_BEAR_SECTOR_RS_PERCENTILE,
  EARLY_BEAR_ALLOWED_GRADES,
} from "../bearExceptionGate";
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

describe("Bear Exception Gate 상수", () => {
  it("Phase 2 지속성 기준은 3일이다", () => {
    expect(BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS).toBe(3);
  });

  it("섹터 RS 퍼센타일 기준은 상위 15%이다", () => {
    expect(BEAR_EXCEPTION_SECTOR_RS_PERCENTILE).toBe(15);
  });

  it("허용 SEPA 등급은 S와 A이다", () => {
    expect(BEAR_EXCEPTION_ALLOWED_GRADES.has("S")).toBe(true);
    expect(BEAR_EXCEPTION_ALLOWED_GRADES.has("A")).toBe(true);
    expect(BEAR_EXCEPTION_ALLOWED_GRADES.has("B")).toBe(false);
  });

  it("EARLY_BEAR 섹터 RS 퍼센타일 기준은 상위 25%이다", () => {
    expect(EARLY_BEAR_SECTOR_RS_PERCENTILE).toBe(25);
  });

  it("EARLY_BEAR 허용 SEPA 등급은 S, A, B이다", () => {
    expect(EARLY_BEAR_ALLOWED_GRADES.has("S")).toBe(true);
    expect(EARLY_BEAR_ALLOWED_GRADES.has("A")).toBe(true);
    expect(EARLY_BEAR_ALLOWED_GRADES.has("B")).toBe(true);
    expect(EARLY_BEAR_ALLOWED_GRADES.has("C")).toBe(false);
    expect(EARLY_BEAR_ALLOWED_GRADES.has("F")).toBe(false);
  });

});

// =============================================================================
// evaluateBearException — 3조건 모두 충족 시 통과
// =============================================================================

describe("evaluateBearException", () => {
  function setupAllPassMocks() {
    // 1. 섹터 RS: rank 2 / total 20 → 10% (≤15% 통과)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "2", total_sectors: "20" }],
    });
    // 2. 펀더멘탈: A등급 (S/A 허용)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    // 3. Phase 2 지속성: 3일
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });
  }

  it("3조건 모두 충족하면 passed: true를 반환한다 (A등급)", async () => {
    setupAllPassMocks();

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
    expect(result.details.sectorRsRank).toBe(2);
    expect(result.details.totalSectors).toBe(20);
    expect(result.details.sectorRsPercentile).toBe(10);
    expect(result.details.fundamentalGrade).toBe("A");
    expect(result.details.phase2Count).toBe(3);
    expect(result.reason).toContain("Bear 예외 통과 [방어섹터]");
    expect(result.path).toBe("defensive_sector");
  });

  it("S등급도 통과한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
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

    expect(result.passed).toBe(true);
    expect(result.details.fundamentalGrade).toBe("S");
  });

  it("섹터 RS가 상위 15% 초과면 passed: false를 반환한다", async () => {
    // rank 4 / total 20 → 20% (15% 초과)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "4", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.sectorRsPercentile).toBe(20);
    expect(result.reason).toContain("섹터RS 20%");
  });

  it("펀더멘탈이 B등급이면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    // B등급 — S/A 미달
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "B" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.fundamentalGrade).toBe("B");
    expect(result.reason).toContain("SEPA B");
  });

  it("Phase 2 지속성이 3일 미만이면 passed: false를 반환한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "1", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    // 2일 — 3일 미만
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "2" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.phase2Count).toBe(2);
    expect(result.reason).toContain("Phase2 지속 2일");
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

  it("섹터 RS rank 3/20 = 15% 는 경계값으로 통과한다", async () => {
    // rank 3 / total 20 → 15% (정확히 경계)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "3", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(true);
    expect(result.details.sectorRsPercentile).toBe(15);
  });

  it("섹터 RS rank 4/20 = 20% 는 경계값 초과로 실패한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "4", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "S" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "LMT",
      sector: "Industrials",
      date: "2026-03-10",
    });

    expect(result.passed).toBe(false);
    expect(result.details.sectorRsPercentile).toBe(20);
  });
});

// =============================================================================
// evaluateBearException — EARLY_BEAR 차등 기준 (#711)
// =============================================================================

describe("evaluateBearException — EARLY_BEAR 차등 기준", () => {
  it("EARLY_BEAR에서 섹터 RS 20%는 통과한다 (BEAR에서는 실패)", async () => {
    // rank 4 / total 20 → 20% (BEAR: >15% 실패, EARLY_BEAR: ≤25% 통과)
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "4", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      regime: "EARLY_BEAR",
    });

    expect(result.passed).toBe(true);
    expect(result.details.sectorRsPercentile).toBe(20);
    expect(result.reason).toContain("Early Bear 예외 통과 [방어섹터]");
    expect(result.path).toBe("defensive_sector");
  });

  it("EARLY_BEAR에서 섹터 RS 25%는 경계값으로 통과한다", async () => {
    // rank 5 / total 20 → 25%
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "5", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "B" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      regime: "EARLY_BEAR",
    });

    expect(result.passed).toBe(true);
    expect(result.details.sectorRsPercentile).toBe(25);
  });

  it("EARLY_BEAR에서 섹터 RS 30%는 실패한다", async () => {
    // rank 6 / total 20 → 30%
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "6", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      regime: "EARLY_BEAR",
    });

    expect(result.passed).toBe(false);
    expect(result.details.sectorRsPercentile).toBe(30);
  });

  it("EARLY_BEAR에서 B등급은 통과한다 (BEAR에서는 실패)", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "2", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "B" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      regime: "EARLY_BEAR",
    });

    expect(result.passed).toBe(true);
    expect(result.details.fundamentalGrade).toBe("B");
  });

  it("EARLY_BEAR에서도 C등급은 실패한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "2", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "C" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      regime: "EARLY_BEAR",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("SEPA C");
  });

  it("regime 미지정 시 BEAR 기준(엄격)을 적용한다", async () => {
    // rank 4 / total 20 → 20% — BEAR 기준(15%) 초과로 실패
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "4", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      // regime 미지정
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Bear 예외 미충족");
  });

  it("BEAR regime 명시 시 엄격 기준을 적용한다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "4", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "B" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "3" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Energy",
      date: "2026-04-09",
      regime: "BEAR",
    });

    expect(result.passed).toBe(false);
    // 섹터RS 20% > 15% 실패, SEPA B 불허
    expect(result.reason).toContain("섹터RS");
    expect(result.reason).toContain("SEPA B");
  });
});

// =============================================================================
// evaluateBearException — RS 최상위 경로 (#777)
// =============================================================================

describe("evaluateBearException — RS 최상위 경로", () => {
  it("RS 최상위 상수는 90이다", () => {
    expect(BEAR_EXCEPTION_RS_TOP_TIER_THRESHOLD).toBe(90);
  });

  function setupDefensiveSectorFailMocks() {
    // 방어 섹터 경로 실패: 섹터RS 50%, SEPA C, Phase 2 5일
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "10", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "C" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });
  }

  it("RS 90+, Phase 2 지속 3일+, 안정성 충족이면 RS 최상위 경로로 통과한다", async () => {
    setupDefensiveSectorFailMocks();

    const result = await evaluateBearException({
      symbol: "NVDA",
      sector: "Technology",
      date: "2026-04-10",
      regime: "EARLY_BEAR",
      rsScore: 92,
      isStable: true,
    });

    expect(result.passed).toBe(true);
    expect(result.path).toBe("rs_top_tier");
    expect(result.reason).toContain("RS최상위");
    expect(result.reason).toContain("RS 92");
  });

  it("RS 90 경계값은 통과한다", async () => {
    setupDefensiveSectorFailMocks();

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Technology",
      date: "2026-04-10",
      rsScore: 90,
      isStable: true,
    });

    expect(result.passed).toBe(true);
    expect(result.path).toBe("rs_top_tier");
  });

  it("RS 89는 RS 최상위 경로 실패한다", async () => {
    setupDefensiveSectorFailMocks();

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Technology",
      date: "2026-04-10",
      rsScore: 89,
      isStable: true,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("RS 89");
  });

  it("RS 92이지만 안정성 미충족이면 RS 최상위 경로 실패한다", async () => {
    setupDefensiveSectorFailMocks();

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Technology",
      date: "2026-04-10",
      rsScore: 92,
      isStable: false,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("안정성 미충족");
  });

  it("RS 92이지만 Phase 2 지속 부족이면 RS 최상위 경로 실패한다", async () => {
    // Phase 2 지속성만 부족하게 설정
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "10", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "C" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "2" }], // 3일 미만
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Technology",
      date: "2026-04-10",
      rsScore: 92,
      isStable: true,
    });

    expect(result.passed).toBe(false);
  });

  it("rsScore가 null이면 RS 최상위 경로 비활성", async () => {
    setupDefensiveSectorFailMocks();

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Technology",
      date: "2026-04-10",
      rsScore: null,
      isStable: true,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("RS N/A");
  });

  it("isStable 미전달 시 RS 최상위 경로 비활성", async () => {
    setupDefensiveSectorFailMocks();

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Technology",
      date: "2026-04-10",
      rsScore: 95,
      // isStable 미전달
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("안정성 미충족");
  });

  it("방어 섹터 경로와 RS 최상위 경로 모두 충족 시 방어 섹터가 우선한다", async () => {
    // 방어 섹터 경로 통과: 섹터RS 10%, SEPA A, Phase 2 3일
    mockPool.query.mockResolvedValueOnce({
      rows: [{ rs_rank: "2", total_sectors: "20" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ grade: "A" }],
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ phase2_count: "5" }],
    });

    const result = await evaluateBearException({
      symbol: "TEST",
      sector: "Industrials",
      date: "2026-04-10",
      regime: "EARLY_BEAR",
      rsScore: 92,
      isStable: true,
    });

    expect(result.passed).toBe(true);
    expect(result.path).toBe("defensive_sector");
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
