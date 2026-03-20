import { describe, it, expect, vi, beforeEach } from "vitest";
import { tagPersistenceReason, tagSubstandardReason } from "../saveRecommendations";

/**
 * saveRecommendations execute() 통합 테스트.
 *
 * 외부 의존성(DB, pool, regimeStore)은 모두 mock 처리.
 * 각 케이스는 독립적으로 실행 가능하며 실제 DB 연결이 없다.
 */

// --- 모듈 mock 설정 ---

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn(),
  },
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("../../../agent/debate/regimeStore", () => ({
  loadConfirmedRegime: vi.fn(),
  loadPendingRegimes: vi.fn(),
}));

vi.mock("@/agent/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- import (mock 이후) ---

import { saveRecommendations } from "../saveRecommendations";
import { pool } from "@/db/client";
import { db } from "@/db/client";
import { loadConfirmedRegime, loadPendingRegimes } from "../../../agent/debate/regimeStore";
import { logger } from "@/agent/logger";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockDb = db as unknown as { insert: ReturnType<typeof vi.fn> };
const mockLoadConfirmedRegime = loadConfirmedRegime as ReturnType<typeof vi.fn>;
const mockLoadPendingRegimes = loadPendingRegimes as ReturnType<typeof vi.fn>;
const mockLogger = logger as unknown as {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};

// --- 헬퍼 ---

function makeRec(overrides?: Partial<{
  symbol: string;
  entry_price: number;
  phase: number;
  rs_score: number;
  sector: string;
  industry: string;
  reason: string;
}>) {
  return {
    symbol: "AAPL",
    entry_price: 100,
    phase: 2,
    rs_score: 80,
    sector: "Technology",
    industry: "Software",
    reason: "강한 RS 모멘텀",
    ...overrides,
  };
}

function makeInsertChain(rowCount: number) {
  return {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount }),
    }),
  };
}

function setupDefaultPoolMocks() {
  // pool.query 호출 순서 (Promise.all 병렬이지만 mock은 순차 소비):
  // 1. activeRows (ACTIVE symbol)
  // 2. cooldownRows (CLOSED/CLOSED_PHASE_EXIT/CLOSED_TRAILING_STOP/CLOSED_STOP_LOSS symbol in cooldown)
  // 3. persistenceRows (stock_phases phase >= 2)  ← activeRows/cooldownRows와 병렬
  // 4. priceRows (daily_prices)
  // saveFactorSnapshot 내부 쿼리는 별도
  mockPool.query
    .mockResolvedValueOnce({ rows: [] })   // activeRows
    .mockResolvedValueOnce({ rows: [] })   // cooldownRows
    .mockResolvedValueOnce({ rows: [] })   // persistenceRows
    .mockResolvedValueOnce({ rows: [] });  // priceRows
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Phase 1: 레짐 하드 게이트
// =============================================================================

describe("Phase 1: 레짐 하드 게이트", () => {
  it("EARLY_BEAR 레짐이면 전체 배치를 차단하고 success: false를 반환한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "EARLY_BEAR",
      regimeDate: "2026-03-10",
      rationale: "약세 초입",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" }), makeRec({ symbol: "MSFT" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.skippedCount).toBe(0);
    expect(parsed.blockedByRegime).toBe(2);
    expect(parsed.blockedByCooldown).toBe(0);
    // DB insert가 전혀 호출되지 않아야 한다
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it("BEAR 레짐이면 전체 배치를 차단하고 success: false를 반환한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "BEAR",
      regimeDate: "2026-03-10",
      rationale: "약세장",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "TSLA" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.blockedByRegime).toBe(1);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it("EARLY_BULL 레짐이면 차단하지 않고 정상 저장을 진행한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "EARLY_BULL",
      regimeDate: "2026-03-10",
      rationale: "강세 초입",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    setupDefaultPoolMocks();
    // saveFactorSnapshot 내부 쿼리 3개
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // stock_phases
      .mockResolvedValueOnce({ rows: [] })  // symbols
      .mockResolvedValueOnce({ rows: [] }); // phase2_ratio breadth

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByRegime).toBe(0);
  });
});

// =============================================================================
// HIGH #1: pending fallback이 Bear Gate를 의도치 않게 활성화하지 않아야 한다
// =============================================================================

describe("HIGH #1: pending fallback Bear Gate 분리", () => {
  it("confirmed 없고 pending EARLY_BEAR일 때 Bear Gate가 발동하지 않고 market_regime=EARLY_BEAR로 저장한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue(null);
    mockLoadPendingRegimes.mockResolvedValue([
      {
        regime: "EARLY_BEAR",
        regimeDate: "2026-03-10",
        rationale: "약세 초입 pending",
        confidence: "medium",
        isConfirmed: false,
        confirmedAt: null,
      },
    ]);

    setupDefaultPoolMocks();
    // saveFactorSnapshot 내부 쿼리 3개
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedRegime: string | null | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedRegime = data.marketRegime as string | null | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    // Bear Gate 미발동 — success: true이어야 한다
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByRegime).toBe(0);
    // 저장된 market_regime은 pending 레짐값이어야 한다
    expect(capturedRegime).toBe("EARLY_BEAR");
    // pending 레짐으로 Bear Gate 발동 경고가 없어야 한다
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Regime",
      expect.stringContaining("pending 레짐 fallback 적용"),
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("차단"),
    );
  });
});

// =============================================================================
// Phase 2: 쿨다운 게이트
// =============================================================================

describe("Phase 2: 쿨다운 게이트", () => {
  beforeEach(() => {
    // EARLY_BULL — 레짐 차단 없음
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "EARLY_BULL",
      regimeDate: "2026-03-10",
      rationale: "강세",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });
  });

  it("쿨다운 기간(7일) 내 CLOSED 이력이 있는 symbol은 blockedByCooldown으로 스킵한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                         // activeRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })     // cooldownRows: AAPL 존재
      .mockResolvedValueOnce({ rows: [] })                         // persistenceRows
      .mockResolvedValueOnce({ rows: [] });                        // priceRows

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByCooldown).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("쿨다운 기간 외(8일 이전) CLOSED 이력은 차단하지 않고 정상 저장한다", async () => {
    // cooldownRows는 비어 있음 — 7일 내 이력 없음
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows: 비어있음
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [] }); // priceRows

    // saveFactorSnapshot
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByCooldown).toBe(0);
  });
});

// =============================================================================
// Phase 3: Phase 2 지속성 태깅
// =============================================================================

describe("Phase 3: Phase 2 지속성 태깅", () => {
  beforeEach(() => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "MID_BULL",
      regimeDate: "2026-03-10",
      rationale: "중기 강세",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });
  });

  it("Phase 2 지속성이 2일 이상이면 [지속성 미확인] 태그를 추가하지 않는다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "2" }] })  // persistenceRows: 2일
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedReason: string | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedReason = data.reason as string | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", reason: "강한 모멘텀" })],
    });

    expect(capturedReason).toBeDefined();
    expect(capturedReason).not.toContain("[지속성 미확인]");
    expect(capturedReason).toBe("강한 모멘텀");
  });

  it("Phase 2 지속성이 1일이면 reason에 [지속성 미확인] 접두사를 추가한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "1" }] })  // persistenceRows: 1일
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedReason: string | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedReason = data.reason as string | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", reason: "모멘텀 상승" })],
    });

    expect(capturedReason).toBeDefined();
    expect(capturedReason).toContain("[지속성 미확인]");
    expect(capturedReason).toBe("[지속성 미확인] 모멘텀 상승");
  });
});

// =============================================================================
// tagPersistenceReason 단위 테스트
// =============================================================================

describe("tagPersistenceReason", () => {
  it("일반 reason에 [지속성 미확인] 접두사를 추가한다", () => {
    expect(tagPersistenceReason("강한 RS 모멘텀")).toBe("[지속성 미확인] 강한 RS 모멘텀");
  });

  it("이미 [지속성 미확인] 태그가 있으면 중복 추가하지 않는다", () => {
    expect(tagPersistenceReason("[지속성 미확인] 기존 사유")).toBe("[지속성 미확인] 기존 사유");
  });

  it("null을 받으면 [지속성 미확인] 태그만 반환한다", () => {
    expect(tagPersistenceReason(null)).toBe("[지속성 미확인]");
  });

  it("빈 문자열을 받으면 [지속성 미확인] 태그만 반환한다", () => {
    expect(tagPersistenceReason("")).toBe("[지속성 미확인]");
  });
});

// =============================================================================
// HIGH 3: 두 태그 동시 적용 + 레짐 null 케이스
// =============================================================================

describe("두 태그 동시 적용", () => {
  beforeEach(() => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "MID_BULL",
      regimeDate: "2026-03-10",
      rationale: "중기 강세",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });
  });

  it("Phase < 2이면서 Phase 2 지속성도 부족하면 [지속성 미확인] [기준 미달] 순서로 두 태그가 모두 붙는다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [] })  // persistenceRows: count 0 (지속성 부족)
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedReason: string | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedReason = data.reason as string | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 1, rs_score: 80, reason: "사유" })],
    });

    // tagSubstandardReason 먼저 적용: "[기준 미달] 사유"
    // tagPersistenceReason 이후 적용: "[지속성 미확인] [기준 미달] 사유"
    expect(capturedReason).toBe("[지속성 미확인] [기준 미달] 사유");
  });
});

// =============================================================================
// T3: market_regime null 방지 — confirmed / pending / 둘다없음 3개 케이스
// =============================================================================

describe("T3: market_regime null 방지 — 레짐 fallback 로직", () => {
  it("confirmed 레짐이 있으면 market_regime = confirmed.regime으로 저장한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "MID_BULL",
      regimeDate: "2026-03-10",
      rationale: "중기 강세",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    setupDefaultPoolMocks();
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedRegime: string | null | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedRegime = data.marketRegime as string | null | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 2, rs_score: 80 })],
    });

    expect(capturedRegime).toBe("MID_BULL");
    // pending 조회를 아예 하지 않아야 한다
    expect(mockLoadPendingRegimes).not.toHaveBeenCalled();
  });

  it("confirmed 레짐 없고 pending 있으면 market_regime = pending.regime으로 저장하고 경고 로그를 출력한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue(null);
    mockLoadPendingRegimes.mockResolvedValue([
      {
        regime: "EARLY_BULL",
        regimeDate: "2026-03-10",
        rationale: "초기 강세 진입",
        confidence: "medium",
        isConfirmed: false,
        confirmedAt: null,
      },
    ]);

    setupDefaultPoolMocks();
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedRegime: string | null | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedRegime = data.marketRegime as string | null | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 2, rs_score: 80 })],
    });

    expect(capturedRegime).toBe("EARLY_BULL");
    expect(mockLoadPendingRegimes).toHaveBeenCalledWith(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Regime",
      expect.stringContaining("pending 레짐 fallback 적용"),
    );
  });

  it("confirmed·pending 레짐 모두 없으면 market_regime = null로 저장하고 경고 로그를 출력한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue(null);
    mockLoadPendingRegimes.mockResolvedValue([]);

    setupDefaultPoolMocks();
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedRegime: string | null | undefined;
    let firstInsertCalled = false;
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        if (!firstInsertCalled) {
          firstInsertCalled = true;
          capturedRegime = data.marketRegime as string | null | undefined;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ rowCount: 1 }),
        };
      }),
    }));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 2, rs_score: 80 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(capturedRegime).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Regime",
      expect.stringContaining("market_regime=null"),
    );
  });
});

describe("레짐 조회 실패 시 fail-open", () => {
  it("loadConfirmedRegime이 throw해도 Bear Gate 미적용으로 정상 저장을 진행한다", async () => {
    mockLoadConfirmedRegime.mockRejectedValue(new Error("DB 연결 실패"));

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByRegime).toBe(0);
  });
});

// =============================================================================
// RS 과열 게이트 통합 테스트
// =============================================================================

describe("RS 과열 게이트", () => {
  beforeEach(() => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "MID_BULL",
      regimeDate: "2026-03-10",
      rationale: "중기 강세",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });
  });

  it("RS > 95인 종목은 blockedByOverheatedRS로 차단한다", async () => {
    setupDefaultPoolMocks();

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", rs_score: 97 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByOverheatedRS).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("RS 97 > 95 과열"),
    );
  });

  it("RS = 95인 종목은 과열 차단 없이 정상 저장한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", rs_score: 95 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByOverheatedRS).toBe(0);
  });

  it("RS 100인 종목 2개 + RS 80인 종목 1개: 과열 2건 차단, 정상 1건 저장", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "MSFT", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [
        makeRec({ symbol: "BATL", rs_score: 100 }),
        makeRec({ symbol: "EONR", rs_score: 98 }),
        makeRec({ symbol: "MSFT", rs_score: 80 }),
      ],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByOverheatedRS).toBe(2);
  });
});
