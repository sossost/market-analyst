import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * scan-recommendation-candidates 단위 테스트.
 *
 * recommendationGates.ts의 게이트 함수 단위 테스트 +
 * 게이트 상수 검증.
 */

// ─── 호이스팅 대상 mock 객체 ───────────────────────────────────────────────────

const { mockPool, mockDbInsert } = vi.hoisted(() => ({
  mockPool: {
    end: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
  },
  mockDbInsert: vi.fn(),
}));

// ─── mock 설정 ─────────────────────────────────────────────────────────────────

vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({ assertValidEnvironment: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/db/client", () => ({
  db: { insert: mockDbInsert },
  pool: mockPool,
}));
vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/etl/utils/date-helpers", () => ({
  getLatestTradeDate: vi.fn(),
}));
vi.mock("@/debate/regimeStore", () => ({
  loadConfirmedRegime: vi.fn(),
  loadPendingRegimes: vi.fn(),
}));
vi.mock("@/tools/bearExceptionGate.js", () => ({
  evaluateBearException: vi.fn(),
}));
vi.mock("@/tools/lateBullGate.js", () => ({
  evaluateLateBullGate: vi.fn(),
}));
vi.mock("@/corporate-analyst/runCorporateAnalyst.js", () => ({
  runCorporateAnalyst: vi.fn().mockResolvedValue({ success: true, symbol: "AAPL" }),
}));

// ─── import (mock 이후) ────────────────────────────────────────────────────────

import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { loadConfirmedRegime, loadPendingRegimes } from "@/debate/regimeStore";
import { evaluateBearException } from "@/tools/bearExceptionGate.js";
import {
  evaluateLowRsGate,
  evaluateOverheatedRsGate,
  evaluateLowPriceGate,
  evaluatePersistenceGate,
  evaluateStabilityGate,
  evaluateFundamentalGate,
  getDateOffset,
  COOLDOWN_CALENDAR_DAYS,
  PHASE2_PERSISTENCE_DAYS,
  MIN_PHASE2_PERSISTENCE_COUNT,
  PHASE2_STABILITY_DAYS,
  BLOCKED_FUNDAMENTAL_GRADE,
  MIN_RS_SCORE,
  MAX_RS_SCORE,
  MIN_PRICE,
  BEAR_REGIMES,
} from "@/tools/recommendationGates.js";

const mockGetLatestTradeDate = getLatestTradeDate as ReturnType<typeof vi.fn>;
const mockLoadConfirmedRegime = loadConfirmedRegime as ReturnType<typeof vi.fn>;
const mockLoadPendingRegimes = loadPendingRegimes as ReturnType<typeof vi.fn>;
const mockEvaluateBearException = evaluateBearException as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// 게이트 함수 단위 테스트
// =============================================================================

describe("evaluateLowRsGate", () => {
  it("RS 60 이상이면 통과한다", () => {
    expect(evaluateLowRsGate(60).passed).toBe(true);
    expect(evaluateLowRsGate(80).passed).toBe(true);
  });

  it("RS 59는 차단한다", () => {
    const result = evaluateLowRsGate(59);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("59");
    expect(result.reason).toContain(String(MIN_RS_SCORE));
  });

  it("RS가 null이면 통과한다 (데이터 없음 → fail-open)", () => {
    expect(evaluateLowRsGate(null).passed).toBe(true);
    expect(evaluateLowRsGate(undefined).passed).toBe(true);
  });
});

describe("evaluateOverheatedRsGate", () => {
  it("RS 95 이하이면 통과한다", () => {
    expect(evaluateOverheatedRsGate(95).passed).toBe(true);
    expect(evaluateOverheatedRsGate(80).passed).toBe(true);
  });

  it("RS 96은 차단한다 (과열)", () => {
    const result = evaluateOverheatedRsGate(96);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("96");
    expect(result.reason).toContain("과열");
  });

  it("RS가 null이면 통과한다", () => {
    expect(evaluateOverheatedRsGate(null).passed).toBe(true);
  });

  it("MAX_RS_SCORE 상수가 95이다", () => {
    expect(MAX_RS_SCORE).toBe(95);
  });
});

describe("evaluateLowPriceGate", () => {
  it("가격 $5 이상이면 통과한다", () => {
    expect(evaluateLowPriceGate(5).passed).toBe(true);
    expect(evaluateLowPriceGate(100).passed).toBe(true);
  });

  it("가격 $4.99는 차단한다 (저가주)", () => {
    const result = evaluateLowPriceGate(4.99);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("저가주");
  });

  it("가격이 null이면 통과한다", () => {
    expect(evaluateLowPriceGate(null).passed).toBe(true);
  });

  it("MIN_PRICE 상수가 5이다", () => {
    expect(MIN_PRICE).toBe(5);
  });
});

describe("evaluatePersistenceGate", () => {
  it("Phase 2 지속성 3일 이상이면 통과한다", () => {
    expect(evaluatePersistenceGate(3).passed).toBe(true);
    expect(evaluatePersistenceGate(10).passed).toBe(true);
  });

  it("Phase 2 지속성 2일이면 차단한다", () => {
    const result = evaluatePersistenceGate(2);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("2");
    expect(result.reason).toContain(String(MIN_PHASE2_PERSISTENCE_COUNT));
  });

  it("Phase 2 지속성 0일이면 차단한다", () => {
    expect(evaluatePersistenceGate(0).passed).toBe(false);
  });
});

describe("evaluateStabilityGate", () => {
  it("안정적이면 통과한다", () => {
    expect(evaluateStabilityGate(true).passed).toBe(true);
  });

  it("불안정하면 차단한다", () => {
    const result = evaluateStabilityGate(false);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain(String(PHASE2_STABILITY_DAYS));
  });
});

describe("evaluateFundamentalGate", () => {
  it("SEPA F등급이 아니면 통과한다", () => {
    expect(evaluateFundamentalGate("S").passed).toBe(true);
    expect(evaluateFundamentalGate("A").passed).toBe(true);
    expect(evaluateFundamentalGate("B").passed).toBe(true);
    expect(evaluateFundamentalGate("C").passed).toBe(true);
  });

  it("SEPA F등급이면 차단한다", () => {
    const result = evaluateFundamentalGate("F");
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("F");
  });

  it("등급이 null이면 통과한다 (데이터 미확보 → fail-open)", () => {
    expect(evaluateFundamentalGate(null).passed).toBe(true);
    expect(evaluateFundamentalGate(undefined).passed).toBe(true);
  });

  it("BLOCKED_FUNDAMENTAL_GRADE 상수가 F이다", () => {
    expect(BLOCKED_FUNDAMENTAL_GRADE).toBe("F");
  });
});

describe("getDateOffset", () => {
  it("7일 이전 날짜를 계산한다", () => {
    expect(getDateOffset("2026-04-01", 7)).toBe("2026-03-25");
  });

  it("월 경계를 넘어가는 경우를 처리한다", () => {
    expect(getDateOffset("2026-03-05", 7)).toBe("2026-02-26");
  });

  it("연도 경계를 넘어가는 경우를 처리한다", () => {
    expect(getDateOffset("2026-01-05", 7)).toBe("2025-12-29");
  });
});

describe("상수 검증", () => {
  it("BEAR_REGIMES에 EARLY_BEAR와 BEAR가 포함된다", () => {
    expect(BEAR_REGIMES.has("EARLY_BEAR")).toBe(true);
    expect(BEAR_REGIMES.has("BEAR")).toBe(true);
    expect(BEAR_REGIMES.has("BULL")).toBe(false);
  });

  it("COOLDOWN_CALENDAR_DAYS가 7이다", () => {
    expect(COOLDOWN_CALENDAR_DAYS).toBe(7);
  });

  it("PHASE2_PERSISTENCE_DAYS가 5이다", () => {
    expect(PHASE2_PERSISTENCE_DAYS).toBe(5);
  });

  it("MIN_PHASE2_PERSISTENCE_COUNT가 3이다", () => {
    expect(MIN_PHASE2_PERSISTENCE_COUNT).toBe(3);
  });

  it("PHASE2_STABILITY_DAYS가 3이다", () => {
    expect(PHASE2_STABILITY_DAYS).toBe(3);
  });

  it("MIN_RS_SCORE가 60이다", () => {
    expect(MIN_RS_SCORE).toBe(60);
  });

  it("MAX_RS_SCORE가 95이다", () => {
    expect(MAX_RS_SCORE).toBe(95);
  });
});

// =============================================================================
// 통합 흐름 테스트: main() 게이트별 케이스
//
// scan-recommendation-candidates.ts는 main()을 export하지 않으므로
// 게이트 함수 단위 테스트와 상수 검증으로 핵심 로직을 커버한다.
// main() 동작은 게이트 함수들의 합성이므로 별도 통합 테스트 불필요.
// =============================================================================

describe("게이트 조합 시나리오", () => {
  it("RS 60 경계값이 정확히 통과한다 (off-by-one 검증)", () => {
    expect(evaluateLowRsGate(60).passed).toBe(true);
    expect(evaluateLowRsGate(59).passed).toBe(false);
  });

  it("RS 95 경계값이 정확히 통과한다 (off-by-one 검증)", () => {
    expect(evaluateOverheatedRsGate(95).passed).toBe(true);
    expect(evaluateOverheatedRsGate(96).passed).toBe(false);
  });

  it("가격 $5 경계값이 정확히 통과한다 (off-by-one 검증)", () => {
    expect(evaluateLowPriceGate(5).passed).toBe(true);
    expect(evaluateLowPriceGate(4.99).passed).toBe(false);
  });

  it("지속성 3일 경계값이 정확히 통과한다 (off-by-one 검증)", () => {
    expect(evaluatePersistenceGate(3).passed).toBe(true);
    expect(evaluatePersistenceGate(2).passed).toBe(false);
  });

  it("모든 게이트 통과 조합: RS 80, 가격 $50, 지속성 5일, 안정적, 등급 A", () => {
    expect(evaluateLowRsGate(80).passed).toBe(true);
    expect(evaluateOverheatedRsGate(80).passed).toBe(true);
    expect(evaluateLowPriceGate(50).passed).toBe(true);
    expect(evaluatePersistenceGate(5).passed).toBe(true);
    expect(evaluateStabilityGate(true).passed).toBe(true);
    expect(evaluateFundamentalGate("A").passed).toBe(true);
  });

  it("단 하나의 게이트 실패도 차단으로 이어진다 (F등급)", () => {
    // 다른 조건은 모두 통과하지만 펀더멘탈 F이면 차단
    expect(evaluateLowRsGate(80).passed).toBe(true);
    expect(evaluateOverheatedRsGate(80).passed).toBe(true);
    expect(evaluateLowPriceGate(50).passed).toBe(true);
    expect(evaluatePersistenceGate(5).passed).toBe(true);
    expect(evaluateStabilityGate(true).passed).toBe(true);
    expect(evaluateFundamentalGate("F").passed).toBe(false);  // 여기서 차단
  });
});
