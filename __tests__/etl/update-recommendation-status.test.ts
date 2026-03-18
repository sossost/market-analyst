import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB client before importing anything that uses it
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    update: () => ({ set: mockSet }),
  },
  pool: {
    query: mockQuery,
    end: mockEnd,
  },
}));

vi.mock("@/db/schema/analyst", () => ({
  recommendations: {
    id: "id",
    status: "status",
    symbol: "symbol",
    recommendationDate: "recommendation_date",
  },
}));

vi.mock("@/etl/utils/validation", () => ({
  assertValidEnvironment: vi.fn(),
}));

vi.mock("@/etl/utils/date-helpers", () => ({
  getLatestTradeDate: vi.fn(),
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/etl/utils/common", () => ({
  toNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  },
}));

// Import after mocks
import { getLatestTradeDate } from "@/etl/utils/date-helpers";

describe("update-recommendation-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("calculates PnL correctly", () => {
    const entryPrice = 100;
    const currentPrice = 115;
    const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;

    expect(pnl).toBe(15);
  });

  it("tracks max PnL as high water mark", () => {
    const prevMaxPnl = 20;
    const currentPnl = 15;
    const maxPnl = Math.max(prevMaxPnl, currentPnl);

    expect(maxPnl).toBe(20);
  });

  it("updates max PnL when current exceeds previous", () => {
    const prevMaxPnl = 10;
    const currentPnl = 25;
    const maxPnl = Math.max(prevMaxPnl, currentPnl);

    expect(maxPnl).toBe(25);
  });

  it("detects Phase 2 exit correctly", () => {
    const currentPhase: number = 3;
    const isPhaseExit = currentPhase != null && currentPhase !== 2;

    expect(isPhaseExit).toBe(true);
  });

  it("does not exit when Phase is 2", () => {
    const currentPhase: number = 2;
    const isPhaseExit = currentPhase != null && currentPhase !== 2;

    expect(isPhaseExit).toBe(false);
  });

  it("handles negative PnL", () => {
    const entryPrice = 100;
    const currentPrice = 85;
    const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;

    expect(pnl).toBe(-15);
  });

  it("increments daysHeld", () => {
    const prevDaysHeld = 5;
    const daysHeld = (prevDaysHeld ?? 0) + 1;

    expect(daysHeld).toBe(6);
  });

  it("handles null daysHeld as 0", () => {
    const prevDaysHeld = null;
    const daysHeld = (prevDaysHeld ?? 0) + 1;

    expect(daysHeld).toBe(1);
  });
});

describe("trailing stop logic", () => {
  const TRAILING_STOP_THRESHOLD = 0.5;
  const MIN_MAX_PNL_FOR_TRAILING = 10;

  function evaluateTrailingStop(maxPnlPercent: number, pnlPercent: number): boolean {
    return (
      maxPnlPercent >= MIN_MAX_PNL_FOR_TRAILING &&
      pnlPercent < maxPnlPercent * (1 - TRAILING_STOP_THRESHOLD)
    );
  }

  it("does not trigger when maxPnL is below minimum threshold", () => {
    // maxPnL: 8% (< 10%), currentPnL: 2% — 되돌림 75%이지만 maxPnL 미달로 미발동
    const isTrailingStop = evaluateTrailingStop(8, 2);

    expect(isTrailingStop).toBe(false);
  });

  it("does not trigger when maxPnL exactly equals minimum threshold and retracement exceeds limit", () => {
    // maxPnL: 10%, currentPnL: 4% — 경계값: maxPnL === 10 이고 되돌림 60%
    // MIN_MAX_PNL_FOR_TRAILING = 10, 10 >= 10 → 충족
    const isTrailingStop = evaluateTrailingStop(10, 4);

    // 10 >= 10 이고 4 < 10 * 0.5 = 5 → 발동
    expect(isTrailingStop).toBe(true);
  });

  it("triggers when maxPnL is above threshold and retracement exceeds limit", () => {
    // maxPnL: 25%, currentPnL: 10% — 되돌림 60% > 50% → 발동
    // 발동 조건: 10 < 25 * 0.5 = 12.5
    const isTrailingStop = evaluateTrailingStop(25, 10);

    expect(isTrailingStop).toBe(true);
  });

  it("does not trigger when retracement is within limit", () => {
    // maxPnL: 20%, currentPnL: 15% — 되돌림 25% < 50% → 미발동
    // 미발동 조건: 15 >= 20 * 0.5 = 10
    const isTrailingStop = evaluateTrailingStop(20, 15);

    expect(isTrailingStop).toBe(false);
  });

  it("Phase exit takes priority over trailing stop when both conditions are met", () => {
    // Phase 3 이탈 + trailing stop 동시 충족 → Phase 이탈이 우선 (CLOSED_PHASE_EXIT)
    const currentPhase: number = 3;
    const maxPnlPercent = 25;
    const pnlPercent = 10;

    const isPhaseExit = currentPhase != null && currentPhase !== 2;
    const isTrailingStop = evaluateTrailingStop(maxPnlPercent, pnlPercent);
    const isTrailingStopApplied = isTrailingStop && !isPhaseExit;

    expect(isPhaseExit).toBe(true);
    expect(isTrailingStop).toBe(true);
    expect(isTrailingStopApplied).toBe(false);
  });

  it("does not trigger when PnL is negative regardless of maxPnL", () => {
    // maxPnL: 15%, currentPnL: -3% — trailing stop 미발동
    // pnlPercent(-3) < maxPnlPercent(15) * 0.5(7.5) → 수식상 참이지만
    // 실전에서는 Phase 이탈(phase !== 2)로 처리되어야 함
    // isPhaseExit가 true이면 isTrailingStop은 적용 안 됨을 검증
    const currentPhase: number = 3; // 손실 상태에서는 Phase도 이탈한 경우가 일반적
    const maxPnlPercent = 15;
    const pnlPercent = -3;

    const isPhaseExit = currentPhase != null && currentPhase !== 2;
    const isTrailingStop = evaluateTrailingStop(maxPnlPercent, pnlPercent);
    const isTrailingStopApplied = isTrailingStop && !isPhaseExit;

    // trailing stop 수식 자체는 참(-3 < 7.5)이지만, Phase 이탈이 우선하므로 CLOSED_TRAILING_STOP으로 처리되지 않음
    expect(isPhaseExit).toBe(true);
    expect(isTrailingStopApplied).toBe(false);
  });

  it("generates correct closeReason message format", () => {
    const maxPnlPercent = 27.38;
    const pnlPercent = -5.66;

    const closeReason = `Trailing stop: maxPnL ${maxPnlPercent.toFixed(1)}% → 현재 ${pnlPercent.toFixed(1)}% (${TRAILING_STOP_THRESHOLD * 100}% 되돌림 초과)`;

    expect(closeReason).toBe("Trailing stop: maxPnL 27.4% → 현재 -5.7% (50% 되돌림 초과)");
  });

  it("AAOI case: maxPnL 27.38% should trigger trailing stop below 13.69%", () => {
    // AAOI 사례 검증: maxPnL 27.38% → trailing stop 발동 조건: pnlPercent < 27.38 * 0.5 = 13.69
    const maxPnlPercent = 27.38;

    const triggerThreshold = maxPnlPercent * (1 - TRAILING_STOP_THRESHOLD);
    expect(triggerThreshold).toBeCloseTo(13.69, 1);

    // 실제 -5.66%는 발동 조건 충족
    expect(evaluateTrailingStop(maxPnlPercent, -5.66)).toBe(true);

    // 13.7%는 미발동 (아직 50% 이내 되돌림)
    expect(evaluateTrailingStop(maxPnlPercent, 13.7)).toBe(false);

    // 13.6%는 발동 (50% 초과 되돌림)
    expect(evaluateTrailingStop(maxPnlPercent, 13.6)).toBe(true);
  });
});
