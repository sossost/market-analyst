import { describe, it, expect, vi, beforeEach } from "vitest";
import { tagPersistenceReason } from "../saveRecommendations";

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

vi.mock("@/debate/regimeStore", () => ({
  loadConfirmedRegime: vi.fn(),
  loadPendingRegimes: vi.fn(),
}));

vi.mock("../bearExceptionGate", () => ({
  evaluateBearException: vi.fn(),
  tagBearExceptionReason: vi.fn((reason: string | null) => {
    const base = reason ?? "";
    if (base.startsWith("[Bear 예외]")) return base;
    return `[Bear 예외] ${base}`.trim();
  }),
  BEAR_EXCEPTION_TAG: "[Bear 예외]",
}));

vi.mock("@/lib/logger", () => ({
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
import { loadConfirmedRegime, loadPendingRegimes } from "@/debate/regimeStore";
import { evaluateBearException } from "../bearExceptionGate";
import { logger } from "@/lib/logger";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockDb = db as unknown as { insert: ReturnType<typeof vi.fn> };
const mockLoadConfirmedRegime = loadConfirmedRegime as ReturnType<typeof vi.fn>;
const mockLoadPendingRegimes = loadPendingRegimes as ReturnType<typeof vi.fn>;
const mockEvaluateBearException = evaluateBearException as ReturnType<typeof vi.fn>;
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

function setupDefaultPoolMocks(overrides?: {
  persistenceRows?: { symbol: string; phase2_count: string }[];
  stabilityRows?: { symbol: string }[];
  fundamentalGradeRows?: { symbol: string; grade: string }[];
}) {
  // pool.query 호출 순서 (Promise.all 병렬이지만 mock은 순차 소비):
  // 1. activeRows (ACTIVE symbol)
  // 2. cooldownRows (CLOSED/CLOSED_PHASE_EXIT/CLOSED_TRAILING_STOP/CLOSED_STOP_LOSS symbol in cooldown)
  // 3. persistenceRows (stock_phases phase = 2)  ← activeRows/cooldownRows와 병렬
  // 4. stabilityRows (최근 N거래일 연속 Phase 2 확인, #436)
  // 5. fundamentalGradeRows (SEPA 등급, #449)
  // 6. priceRows (daily_prices)
  // saveFactorSnapshot 내부 쿼리는 별도
  const defaultPersistence = overrides?.persistenceRows ?? [{ symbol: "AAPL", phase2_count: "3" }];
  const defaultStability = overrides?.stabilityRows ?? [{ symbol: "AAPL" }];
  const defaultFundamental = overrides?.fundamentalGradeRows ?? [];
  mockPool.query
    .mockResolvedValueOnce({ rows: [] })                // activeRows
    .mockResolvedValueOnce({ rows: [] })                // cooldownRows
    .mockResolvedValueOnce({ rows: defaultPersistence }) // persistenceRows
    .mockResolvedValueOnce({ rows: defaultStability })   // stabilityRows
    .mockResolvedValueOnce({ rows: defaultFundamental }) // fundamentalGradeRows
    .mockResolvedValueOnce({ rows: [] });               // priceRows
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Phase 1: 레짐 하드 게이트
// =============================================================================

describe("Phase 1: 레짐 하드 게이트 + Bear 예외", () => {
  it("EARLY_BEAR 레짐에서 Bear 예외 미충족 종목은 blockedByRegime로 차단한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "EARLY_BEAR",
      regimeDate: "2026-03-10",
      rationale: "약세 초입",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    setupDefaultPoolMocks();

    // Bear 예외 미충족
    mockEvaluateBearException.mockResolvedValue({
      passed: false,
      reason: "Bear 예외 미충족: 섹터RS 50%, SEPA A",
      details: { sectorRsRank: 10, totalSectors: 20, sectorRsPercentile: 50, fundamentalGrade: "A", phase2Count: 3 },
    });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" }), makeRec({ symbol: "MSFT" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByRegime).toBe(2);
    expect(parsed.bearExceptionCount).toBe(0);
    // Bear 예외 평가를 각 종목별로 호출해야 한다
    expect(mockEvaluateBearException).toHaveBeenCalledTimes(2);
  });

  it("BEAR 레짐에서 Bear 예외 미충족 종목은 blockedByRegime로 차단한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "BEAR",
      regimeDate: "2026-03-10",
      rationale: "약세장",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    setupDefaultPoolMocks();

    mockEvaluateBearException.mockResolvedValue({
      passed: false,
      reason: "Bear 예외 미충족",
      details: { sectorRsRank: null, totalSectors: null, sectorRsPercentile: null, fundamentalGrade: "F", phase2Count: 0 },
    });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "TSLA" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.blockedByRegime).toBe(1);
    expect(parsed.bearExceptionCount).toBe(0);
  });

  it("EARLY_BEAR 레짐에서 Bear 예외 통과 종목은 [Bear 예외] 태그와 함께 저장한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "EARLY_BEAR",
      regimeDate: "2026-03-10",
      rationale: "약세 초입",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "LMT", phase2_count: "5" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "LMT" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockEvaluateBearException.mockResolvedValue({
      passed: true,
      reason: "Bear 예외 통과: 섹터RS 상위5%, SEPA S, Phase2 5일",
      details: { sectorRsRank: 1, totalSectors: 20, sectorRsPercentile: 5, fundamentalGrade: "S", phase2Count: 5 },
    });

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

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "LMT", sector: "Industrials", rs_score: 90, reason: "방산 섹터 역행 강세" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByRegime).toBe(0);
    expect(parsed.bearExceptionCount).toBe(1);
    // [Bear 예외] 태그가 붙어야 한다
    expect(capturedReason).toContain("[Bear 예외]");
  });

  it("BEAR 레짐에서 2종목 중 1개만 Bear 예외 통과 시 혼합 결과를 반환한다", async () => {
    mockLoadConfirmedRegime.mockResolvedValue({
      regime: "BEAR",
      regimeDate: "2026-03-10",
      rationale: "약세장",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-10",
    });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "LMT", phase2_count: "5" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "LMT" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot (LMT만 저장됨)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    // LMT: 통과, AAPL: 실패
    mockEvaluateBearException
      .mockResolvedValueOnce({
        passed: true,
        reason: "Bear 예외 통과",
        details: { sectorRsRank: 1, totalSectors: 20, sectorRsPercentile: 5, fundamentalGrade: "S", phase2Count: 5 },
      })
      .mockResolvedValueOnce({
        passed: false,
        reason: "Bear 예외 미충족",
        details: { sectorRsRank: 10, totalSectors: 20, sectorRsPercentile: 50, fundamentalGrade: "B", phase2Count: 1 },
      });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [
        makeRec({ symbol: "LMT", sector: "Industrials" }),
        makeRec({ symbol: "AAPL", sector: "Technology" }),
      ],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByRegime).toBe(1);
    expect(parsed.bearExceptionCount).toBe(1);
  });

  it("EARLY_BULL 레짐이면 Bear 예외 평가 없이 정상 저장을 진행한다", async () => {
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
      recommendations: [makeRec({ symbol: "AAPL", entry_price: 100 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByRegime).toBe(0);
    // Bear 예외 평가가 호출되지 않아야 한다
    expect(mockEvaluateBearException).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({ rows: [] })                         // stabilityRows
      .mockResolvedValueOnce({ rows: [] })                         // fundamentalGradeRows
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
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
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
// Phase 3: Phase 2 지속성 하드 블록
// =============================================================================

describe("Phase 3: Phase 2 지속성 하드 블록", () => {
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

  it("Phase 2 지속성이 3일 이상이면 정상 저장한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows: 3일
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", reason: "강한 모멘텀" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByPersistence).toBe(0);
  });

  it("Phase 2 지속성이 2일이면 blockedByPersistence로 차단한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "2" }] })  // persistenceRows: 2일
      .mockResolvedValueOnce({ rows: [] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] });  // priceRows

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", reason: "모멘텀 상승" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByPersistence).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("Phase 2 지속성"),
    );
  });

  it("Phase 2 지속성이 0일이면 blockedByPersistence로 차단한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [] })  // persistenceRows: 0일
      .mockResolvedValueOnce({ rows: [] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] });  // priceRows

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByPersistence).toBe(1);
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
// Phase/RS 하드 게이트 (#366)
// =============================================================================

describe("Phase 하드 게이트", () => {
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

  it("Phase < 2 종목은 blockedByPhase로 차단한다", async () => {
    setupDefaultPoolMocks();

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 1, rs_score: 80, reason: "사유" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByPhase).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("Phase 1 < 2"),
    );
  });

  it("Phase = 2 종목은 Phase 하드 게이트를 통과한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 2, rs_score: 80 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByPhase).toBe(0);
  });
});

describe("RS 하한 하드 게이트", () => {
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

  it("RS < 60 종목은 blockedByLowRS로 차단한다", async () => {
    setupDefaultPoolMocks();

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 2, rs_score: 55, reason: "사유" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByLowRS).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("RS 55 < 60"),
    );
  });

  it("RS = 60 종목은 RS 하한 게이트를 통과한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL", phase: 2, rs_score: 60 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByLowRS).toBe(0);
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
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
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
    setupDefaultPoolMocks({ persistenceRows: [] });

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
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
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
      .mockResolvedValueOnce({ rows: [{ symbol: "MSFT" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
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

// =============================================================================
// 저가주 하드 게이트
// =============================================================================

describe("저가주 하드 게이트", () => {
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

  it("entry_price < $5인 종목은 blockedByLowPrice로 차단한다", async () => {
    setupDefaultPoolMocks({ persistenceRows: [{ symbol: "EONR", phase2_count: "3" }] });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "EONR", entry_price: 1.53 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByLowPrice).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("저가주"),
    );
  });

  it("entry_price = $4.99인 종목은 차단한다", async () => {
    setupDefaultPoolMocks({ persistenceRows: [{ symbol: "DWSN", phase2_count: "3" }] });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "DWSN", entry_price: 4.99 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.blockedByLowPrice).toBe(1);
  });

  it("entry_price = $5인 종목은 정상 저장한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "XYZ", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "XYZ" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "XYZ", entry_price: 5.0 })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByLowPrice).toBe(0);
  });

  it("저가주 2개 + 정상가 1개: 2건 차단, 1건 저장", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "MSFT", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "MSFT" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [
        makeRec({ symbol: "EONR", entry_price: 1.53 }),
        makeRec({ symbol: "DWSN", entry_price: 4.42 }),
        makeRec({ symbol: "MSFT", entry_price: 350 }),
      ],
    });

    const parsed = JSON.parse(result);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByLowPrice).toBe(2);
  });
});

// =============================================================================
// Phase 4: 펀더멘탈 하드 게이트 (#449)
// =============================================================================

describe("Phase 4: 펀더멘탈 하드 게이트", () => {
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

  it("SEPA F등급 종목은 blockedByFundamental로 차단한다", async () => {
    setupDefaultPoolMocks({
      fundamentalGradeRows: [{ symbol: "AAPL", grade: "F" }],
    });

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "AAPL" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.blockedByFundamental).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "QualityGate",
      expect.stringContaining("SEPA 등급 F"),
    );
  });

  it("SEPA C등급 종목은 펀더멘탈 게이트를 통과한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", grade: "C" }] })  // fundamentalGradeRows
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
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByFundamental).toBe(0);
  });

  it("SEPA B등급 종목은 펀더멘탈 게이트를 통과한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", grade: "B" }] })  // fundamentalGradeRows
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
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByFundamental).toBe(0);
  });

  it("fundamental_scores에 데이터 없는 종목은 fail-open으로 통과한다", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "NEWCO", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [{ symbol: "NEWCO" }] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [] })  // fundamentalGradeRows: 데이터 없음
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [makeRec({ symbol: "NEWCO" })],
    });

    const parsed = JSON.parse(result);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByFundamental).toBe(0);
  });

  it("F등급 2건 + A등급 1건: 펀더멘탈 2건 차단, 정상 1건 저장", async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [
        { symbol: "ALTO", phase2_count: "3" },
        { symbol: "VICR", phase2_count: "3" },
        { symbol: "MSFT", phase2_count: "3" },
      ] })  // persistenceRows
      .mockResolvedValueOnce({ rows: [
        { symbol: "ALTO" },
        { symbol: "VICR" },
        { symbol: "MSFT" },
      ] })  // stabilityRows
      .mockResolvedValueOnce({ rows: [
        { symbol: "ALTO", grade: "F" },
        { symbol: "VICR", grade: "F" },
        { symbol: "MSFT", grade: "A" },
      ] })  // fundamentalGradeRows
      .mockResolvedValueOnce({ rows: [] })  // priceRows
      // saveFactorSnapshot (MSFT만 저장됨)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    mockDb.insert.mockReturnValue(makeInsertChain(1));

    const result = await saveRecommendations.execute({
      date: "2026-03-10",
      recommendations: [
        makeRec({ symbol: "ALTO" }),
        makeRec({ symbol: "VICR" }),
        makeRec({ symbol: "MSFT" }),
      ],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.blockedByFundamental).toBe(2);
  });
});
