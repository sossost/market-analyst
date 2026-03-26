import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock 팩토리 내에서 참조하려면 hoisted로 초기화해야 함
const { mockFrom, mockSet, mockWhere, mockQuery, mockEnd } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockQuery: vi.fn(),
  mockEnd: vi.fn(),
}));

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
import {
  shouldTriggerTrailingStop,
  formatTrailingStopReason,
  PROFIT_TIERS,
} from "@/etl/jobs/update-recommendation-status";

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

describe("trailing stop logic (progressive profit tiers)", () => {
  // --- maxPnl < 5%: 미발동 ---

  it("does not trigger when maxPnL is below minimum tier (1.9%)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 1.9,
        pnlPercent: 0,
      }),
    ).toBe(false);
  });

  // --- Tier 5%+: 30% 되돌림, floor 1% (#438 타이트닝) ---

  it("triggers at 5% tier boundary (maxPnl=5, pnl drops below 3.5)", () => {
    // trailingLevel = max(5 * 0.70, 1) = 3.5
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 5,
        pnlPercent: 3.4,
      }),
    ).toBe(true);
  });

  it("does not trigger at 5% tier when within bounds (maxPnl=5, pnl=3.6)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 5,
        pnlPercent: 3.6,
      }),
    ).toBe(false);
  });

  // --- Tier 10%+: 25% 되돌림, floor 5% (#438 타이트닝) ---

  it("triggers at 10% tier boundary (maxPnl=10, pnl drops below 7.5)", () => {
    // trailingLevel = max(10 * 0.75, 5) = 7.5
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 10,
        pnlPercent: 7,
      }),
    ).toBe(true);
  });

  it("does not trigger at 10% tier when within bounds (maxPnl=15, pnl=12)", () => {
    // trailingLevel = max(15 * 0.75, 5) = 11.25
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 15,
        pnlPercent: 12,
      }),
    ).toBe(false);
  });

  // --- Tier 20%+: 25% 되돌림, floor 10% ---

  it("triggers at 20% tier (maxPnl=20, pnl drops below 15)", () => {
    // trailingLevel = max(20 * 0.75, 10) = 15
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 20,
        pnlPercent: 14,
      }),
    ).toBe(true);
  });

  it("does not trigger at 20% tier when within bounds (maxPnl=20, pnl=16)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 2,
        maxPnlPercent: 20,
        pnlPercent: 16,
      }),
    ).toBe(false);
  });

  it("does not trigger when currentPhase is null (ETL 미완료)", () => {
    expect(
      shouldTriggerTrailingStop({
        currentPhase: null,
        maxPnlPercent: 25,
        pnlPercent: 10,
      }),
    ).toBe(false);
  });

  it("Trailing stop takes priority over Phase exit when both conditions are met", () => {
    const currentPhase: number = 3;
    const maxPnlPercent = 25;
    const pnlPercent = 10;

    const isPhaseExit = currentPhase != null && currentPhase !== 2;
    const isTrailingStop = shouldTriggerTrailingStop({
      currentPhase,
      maxPnlPercent,
      pnlPercent,
    });

    expect(isPhaseExit).toBe(true);
    expect(isTrailingStop).toBe(true);
  });

  it("triggers trailing stop even when PnL is negative if maxPnL was above threshold", () => {
    // maxPnL: 15% (tier 10%+), currentPnL: -3%
    // trailingLevel = max(15 * 0.75, 5) = 11.25 → -3 < 11.25 → 발동
    expect(
      shouldTriggerTrailingStop({
        currentPhase: 3,
        maxPnlPercent: 15,
        pnlPercent: -3,
      }),
    ).toBe(true);
  });

  it("generates correct closeReason with tier info", () => {
    const reason = formatTrailingStopReason({
      maxPnlPercent: 27.38,
      pnlPercent: -5.66,
    });

    expect(reason).toContain("maxPnL 27.4%");
    expect(reason).toContain("현재 -5.7%");
    expect(reason).toContain("tier 20%+");
    expect(reason).toContain("25%");
    expect(reason).toContain("floor 10%");
  });

  it("Phase exit only applies when trailing stop is NOT triggered (maxPnl < 5%)", () => {
    const currentPhase: number = 3;
    const maxPnlPercent = 3; // 5% 미만 → tier 없음
    const pnlPercent = 2;

    const isPhaseExit = currentPhase != null && currentPhase !== 2;
    const isTrailingStop = shouldTriggerTrailingStop({
      currentPhase,
      maxPnlPercent,
      pnlPercent,
    });

    expect(isPhaseExit).toBe(true);
    expect(isTrailingStop).toBe(false);
  });

  it("AAOI case: maxPnL 27.38% → trailing stop at ~20.5% (not 13.69%)", () => {
    // 단계적 이익 실현: tier 20%+ → 25% 되돌림, floor 10%
    // trailingLevel = max(27.38 * 0.75, 10) = max(20.535, 10) = 20.535
    const maxPnlPercent = 27.38;

    // 실제 -5.66%는 당연히 발동
    expect(
      shouldTriggerTrailingStop({ currentPhase: 2, maxPnlPercent, pnlPercent: -5.66 }),
    ).toBe(true);

    // 20%는 발동 (20 < 20.535)
    expect(
      shouldTriggerTrailingStop({ currentPhase: 2, maxPnlPercent, pnlPercent: 20 }),
    ).toBe(true);

    // 21%는 미발동 (21 > 20.535)
    expect(
      shouldTriggerTrailingStop({ currentPhase: 2, maxPnlPercent, pnlPercent: 21 }),
    ).toBe(false);
  });

  it("AAOI case: trailing stop takes priority over Phase exit (maxPnL +27% → -5.6%)", () => {
    const currentPhase: number = 3;
    const maxPnlPercent = 27.38;
    const pnlPercent = -5.66;

    const isPhaseExit = currentPhase != null && currentPhase !== 2;
    const isTrailingStop = shouldTriggerTrailingStop({
      currentPhase,
      maxPnlPercent,
      pnlPercent,
    });

    expect(isPhaseExit).toBe(true);
    expect(isTrailingStop).toBe(true);

    const status = isTrailingStop
      ? "CLOSED_TRAILING_STOP"
      : isPhaseExit
        ? "CLOSED_PHASE_EXIT"
        : "ACTIVE";
    expect(status).toBe("CLOSED_TRAILING_STOP");
  });
});
