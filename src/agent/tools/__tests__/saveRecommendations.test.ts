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

vi.mock("../../../agent/debate/regimeStore", () => ({
  loadConfirmedRegime: vi.fn(),
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
import { loadConfirmedRegime } from "../../../agent/debate/regimeStore";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockDb = db as unknown as { insert: ReturnType<typeof vi.fn> };
const mockLoadConfirmedRegime = loadConfirmedRegime as ReturnType<typeof vi.fn>;

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
  // pool.query 호출 순서:
  // 1. activeRows (ACTIVE symbol)
  // 2. cooldownRows (CLOSED/CLOSED_PHASE_EXIT symbol in cooldown)
  // 3. persistenceRows (stock_phases phase >= 2)
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
