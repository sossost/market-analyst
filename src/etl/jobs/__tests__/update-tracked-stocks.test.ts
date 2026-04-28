/**
 * update-tracked-stocks 단위 테스트.
 *
 * 순수 함수(수익률 계산, 만료 판정, Phase Exit 판정, 듀레이션 스냅샷 등)를 격리 테스트한다.
 * DB/pool은 mock 처리한다.
 *
 * Issue #773 — tracked_stocks 통합 ETL Phase 2
 * Issue #833 — Phase Exit 자동화
 * Issue #796 — phase2_since null 백필
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// DB 의존성 mock
vi.mock("@/db/client", () => ({
  pool: { query: vi.fn(), end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));

const mockFindPhase2SinceDates = vi.fn();
const mockUpdatePhase2Since = vi.fn();

vi.mock("@/db/repositories/stockPhaseRepository.js", () => ({
  findPhase2SinceDates: (...args: unknown[]) => mockFindPhase2SinceDates(...args),
}));
vi.mock("@/db/repositories/trackedStocksRepository.js", () => ({
  findActiveTrackedStocks: vi.fn(),
  updateTracking: vi.fn(),
  updatePhase2Since: (...args: unknown[]) => mockUpdatePhase2Since(...args),
  expireTrackedStock: vi.fn(),
  exitTrackedStock: vi.fn(),
}));
vi.mock("@/db/repositories/sectorRepository.js", () => ({
  findSectorRsByName: vi.fn(),
}));
vi.mock("@/etl/utils/validation", () => ({
  assertValidEnvironment: vi.fn(),
}));
vi.mock("@/etl/utils/date-helpers", () => ({
  getLatestTradeDate: vi.fn(),
}));

import {
  calculatePnlPercent,
  calculateMaxPnlPercent,
  isExpired,
  isPhaseExitTriggered,
  calculateDaysTracked,
  buildUpdatedTrajectory,
  calculateDurationReturn,
  backfillPhase2Since,
  PROFIT_TIERS,
  findProfitTier,
  shouldTriggerTrailingStop,
  formatTrailingStopReason,
  type TrajectoryPoint,
} from "../update-tracked-stocks.js";
import type { TrackedStockRow } from "@/db/repositories/trackedStocksRepository.js";

// =============================================================================
// calculatePnlPercent — 수익률 계산
// =============================================================================

describe("calculatePnlPercent", () => {
  it("진입가 100, 현재가 110이면 +10%를 반환한다", () => {
    expect(calculatePnlPercent(100, 110)).toBeCloseTo(10);
  });

  it("진입가 100, 현재가 90이면 -10%를 반환한다", () => {
    expect(calculatePnlPercent(100, 90)).toBeCloseTo(-10);
  });

  it("진입가와 현재가가 같으면 0%를 반환한다", () => {
    expect(calculatePnlPercent(50, 50)).toBe(0);
  });

  it("진입가가 0이면 null을 반환한다", () => {
    expect(calculatePnlPercent(0, 110)).toBeNull();
  });

  it("진입가가 null이면 null을 반환한다", () => {
    expect(calculatePnlPercent(null, 110)).toBeNull();
  });

  it("현재가가 null이면 null을 반환한다", () => {
    expect(calculatePnlPercent(100, null)).toBeNull();
  });

  it("현재가가 0이면 null을 반환한다", () => {
    expect(calculatePnlPercent(100, 0)).toBeNull();
  });
});

// =============================================================================
// calculateMaxPnlPercent — 최대 수익률 갱신
// =============================================================================

describe("calculateMaxPnlPercent", () => {
  it("현재 PnL이 기존 max보다 크면 현재 PnL을 반환한다", () => {
    expect(calculateMaxPnlPercent(10, 15)).toBe(15);
  });

  it("현재 PnL이 기존 max보다 작으면 기존 max를 반환한다", () => {
    expect(calculateMaxPnlPercent(10, 5)).toBe(10);
  });

  it("기존 max가 null이고 현재 PnL이 있으면 현재 PnL을 반환한다", () => {
    expect(calculateMaxPnlPercent(null, 8)).toBe(8);
  });

  it("현재 PnL이 null이고 기존 max가 있으면 기존 max를 반환한다", () => {
    expect(calculateMaxPnlPercent(10, null)).toBe(10);
  });

  it("둘 다 null이면 null을 반환한다", () => {
    expect(calculateMaxPnlPercent(null, null)).toBeNull();
  });

  it("음수 PnL에서 기존 max가 더 높으면 기존 max를 유지한다", () => {
    expect(calculateMaxPnlPercent(5, -3)).toBe(5);
  });
});

// =============================================================================
// isExpired — 만료 판정
// =============================================================================

describe("isExpired", () => {
  it("현재 날짜가 tracking_end_date를 초과하면 true를 반환한다", () => {
    expect(isExpired("2026-04-20", "2026-04-19")).toBe(true);
  });

  it("현재 날짜가 tracking_end_date와 같으면 false를 반환한다 (당일은 유효)", () => {
    expect(isExpired("2026-04-19", "2026-04-19")).toBe(false);
  });

  it("현재 날짜가 tracking_end_date 이전이면 false를 반환한다", () => {
    expect(isExpired("2026-04-18", "2026-04-19")).toBe(false);
  });

  it("tracking_end_date가 null이면 false를 반환한다", () => {
    expect(isExpired("2026-04-20", null)).toBe(false);
  });
});

// =============================================================================
// isPhaseExitTriggered — Phase Exit 판정
// =============================================================================

describe("isPhaseExitTriggered", () => {
  it("Phase 2 진입 → Phase 1 전환이면 true를 반환한다", () => {
    expect(isPhaseExitTriggered(2, 1)).toBe(true);
  });

  it("Phase 2 진입 → Phase 4 전환이면 true를 반환한다", () => {
    expect(isPhaseExitTriggered(2, 4)).toBe(true);
  });

  it("Phase 2 진입 → Phase 2 유지이면 false를 반환한다", () => {
    expect(isPhaseExitTriggered(2, 2)).toBe(false);
  });

  it("Phase 2 진입 → Phase 3 전환이면 false를 반환한다 (자연 진행)", () => {
    expect(isPhaseExitTriggered(2, 3)).toBe(false);
  });

  it("Phase 1 진입이면 어떤 전환이든 false를 반환한다", () => {
    expect(isPhaseExitTriggered(1, 2)).toBe(false);
    expect(isPhaseExitTriggered(1, 4)).toBe(false);
  });

  it("Phase 3 진입이면 false를 반환한다", () => {
    expect(isPhaseExitTriggered(3, 1)).toBe(false);
    expect(isPhaseExitTriggered(3, 4)).toBe(false);
  });

  it("currentPhase가 null이면 false를 반환한다", () => {
    expect(isPhaseExitTriggered(2, null)).toBe(false);
  });
});

// =============================================================================
// calculateDaysTracked — 경과일 계산
// =============================================================================

describe("calculateDaysTracked", () => {
  it("오늘이 entry_date와 같으면 0일을 반환한다", () => {
    expect(calculateDaysTracked("2026-04-01", "2026-04-01")).toBe(0);
  });

  it("1일 경과 시 1을 반환한다", () => {
    expect(calculateDaysTracked("2026-04-01", "2026-04-02")).toBe(1);
  });

  it("30일 경과 시 30을 반환한다", () => {
    expect(calculateDaysTracked("2026-03-01", "2026-03-31")).toBe(30);
  });

  it("현재 날짜가 entry_date 이전이면 0을 반환한다 (음수 방지)", () => {
    expect(calculateDaysTracked("2026-04-15", "2026-04-10")).toBe(0);
  });
});

// =============================================================================
// buildUpdatedTrajectory — phase_trajectory 누적
// =============================================================================

describe("buildUpdatedTrajectory", () => {
  it("기존 배열에 새 포인트를 날짜순으로 추가한다", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-04-10", phase: 2, rsScore: 70 },
    ];
    const result = buildUpdatedTrajectory(existing, {
      date: "2026-04-11",
      phase: 2,
      rsScore: 72,
    });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ date: "2026-04-11", phase: 2, rsScore: 72 });
  });

  it("동일 날짜가 이미 존재하면 교체한다", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-04-10", phase: 1, rsScore: 55 },
    ];
    const result = buildUpdatedTrajectory(existing, {
      date: "2026-04-10",
      phase: 2,
      rsScore: 70,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-04-10", phase: 2, rsScore: 70 });
  });

  it("기존 배열이 null이면 새 포인트 하나만 반환한다", () => {
    const result = buildUpdatedTrajectory(null, {
      date: "2026-04-11",
      phase: 2,
      rsScore: 75,
    });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-11");
  });

  it("날짜 오름차순으로 정렬된다", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-04-13", phase: 2, rsScore: 80 },
      { date: "2026-04-11", phase: 2, rsScore: 75 },
    ];
    const result = buildUpdatedTrajectory(existing, {
      date: "2026-04-12",
      phase: 2,
      rsScore: 77,
    });
    expect(result[0].date).toBe("2026-04-11");
    expect(result[1].date).toBe("2026-04-12");
    expect(result[2].date).toBe("2026-04-13");
  });

  it("원본 배열을 변경하지 않는다 (불변성)", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-04-10", phase: 2, rsScore: 70 },
    ];
    const originalLength = existing.length;
    buildUpdatedTrajectory(existing, { date: "2026-04-11", phase: 2, rsScore: 72 });
    expect(existing).toHaveLength(originalLength);
  });
});

// =============================================================================
// calculateDurationReturn — 듀레이션 수익률 스냅샷
// =============================================================================

describe("calculateDurationReturn", () => {
  it("entry_date + durationDays 이후이고 아직 null이면 수익률을 계산한다", () => {
    const result = calculateDurationReturn({
      entryDate: "2026-01-01",
      entryPrice: 100,
      currentDate: "2026-01-09",
      currentPrice: 115,
      existingSnapshot: null,
      durationDays: 7,
    });
    expect(result).toBeCloseTo(15);
  });

  it("이미 스냅샷이 존재하면 변경하지 않는다 (immutable snapshot)", () => {
    const result = calculateDurationReturn({
      entryDate: "2026-01-01",
      entryPrice: 100,
      currentDate: "2026-01-09",
      currentPrice: 120,
      existingSnapshot: 15,
      durationDays: 7,
    });
    expect(result).toBe(15);
  });

  it("entry_date + durationDays 미도달 시 null을 반환한다", () => {
    const result = calculateDurationReturn({
      entryDate: "2026-01-01",
      entryPrice: 100,
      currentDate: "2026-01-05",
      currentPrice: 110,
      existingSnapshot: null,
      durationDays: 7,
    });
    expect(result).toBeNull();
  });

  it("currentPrice가 null이면 null을 반환한다", () => {
    const result = calculateDurationReturn({
      entryDate: "2026-01-01",
      entryPrice: 100,
      currentDate: "2026-01-09",
      currentPrice: null,
      existingSnapshot: null,
      durationDays: 7,
    });
    expect(result).toBeNull();
  });

  it("entry_date + durationDays 정확히 도달한 날에도 계산한다 (경계값)", () => {
    const result = calculateDurationReturn({
      entryDate: "2026-01-01",
      entryPrice: 100,
      currentDate: "2026-01-08",
      currentPrice: 108,
      existingSnapshot: null,
      durationDays: 7,
    });
    expect(result).toBeCloseTo(8);
  });

  it("entryPrice가 0이면 null을 반환한다", () => {
    const result = calculateDurationReturn({
      entryDate: "2026-01-01",
      entryPrice: 0,
      currentDate: "2026-01-09",
      currentPrice: 110,
      existingSnapshot: null,
      durationDays: 7,
    });
    expect(result).toBeNull();
  });
});

// =============================================================================
// findProfitTier — profit tier 매칭
// =============================================================================

describe("findProfitTier", () => {
  it("maxPnl 25%이면 20%+ tier를 반환한다", () => {
    const tier = findProfitTier(25);
    expect(tier).not.toBeNull();
    expect(tier!.minMaxPnl).toBe(20);
  });

  it("maxPnl 15%이면 10%+ tier를 반환한다", () => {
    const tier = findProfitTier(15);
    expect(tier).not.toBeNull();
    expect(tier!.minMaxPnl).toBe(10);
  });

  it("maxPnl 7%이면 5%+ tier를 반환한다", () => {
    const tier = findProfitTier(7);
    expect(tier).not.toBeNull();
    expect(tier!.minMaxPnl).toBe(5);
  });

  it("maxPnl 3%이면 2%+ tier를 반환한다", () => {
    const tier = findProfitTier(3);
    expect(tier).not.toBeNull();
    expect(tier!.minMaxPnl).toBe(2);
  });

  it("maxPnl 1.5%이면 null을 반환한다 (보호 대상 아님)", () => {
    expect(findProfitTier(1.5)).toBeNull();
  });

  it("maxPnl 0%이면 null을 반환한다", () => {
    expect(findProfitTier(0)).toBeNull();
  });

  it("경계값: maxPnl 정확히 2%이면 2%+ tier를 반환한다", () => {
    const tier = findProfitTier(2);
    expect(tier).not.toBeNull();
    expect(tier!.minMaxPnl).toBe(2);
  });

  it("경계값: maxPnl 정확히 20%이면 20%+ tier를 반환한다", () => {
    const tier = findProfitTier(20);
    expect(tier).not.toBeNull();
    expect(tier!.minMaxPnl).toBe(20);
  });
});

// =============================================================================
// shouldTriggerTrailingStop — trailing stop 발동 판정
// =============================================================================

describe("shouldTriggerTrailingStop", () => {
  it("maxPnl < 2%이면 tier 없으므로 발동하지 않는다", () => {
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 1.5,
      pnlPercent: 0.5,
    })).toBe(false);
  });

  it("maxPnl 27.4%, pnl 20%이면 발동한다 (20%+ tier: level = max(20.55, 10) = 20.55)", () => {
    // trailing level = 27.4 * (1 - 0.25) = 20.55
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 27.4,
      pnlPercent: 20,
    })).toBe(true);
  });

  it("maxPnl 27.4%, pnl 21%이면 발동하지 않는다 (level 20.55 미만 아님)", () => {
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 27.4,
      pnlPercent: 21,
    })).toBe(false);
  });

  it("maxPnl 15%, pnl 5%이면 발동한다 (10%+ tier: level = max(11.25, 5) = 11.25)", () => {
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 15,
      pnlPercent: 5,
    })).toBe(true);
  });

  it("maxPnl 7%, pnl 4%이면 발동한다 (5%+ tier: level = max(4.9, 1) = 4.9)", () => {
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 7,
      pnlPercent: 4,
    })).toBe(true);
  });

  it("maxPnl 3%, pnl 1%이면 발동한다 (2%+ tier: level = max(1.5, 0) = 1.5)", () => {
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 3,
      pnlPercent: 1,
    })).toBe(true);
  });

  it("maxPnl 3%, pnl 2%이면 발동하지 않는다 (2%+ tier: level = 1.5)", () => {
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 3,
      pnlPercent: 2,
    })).toBe(false);
  });

  it("profitFloor가 적용된다: maxPnl 10%, pnl 4%이면 발동 (10%+ tier: floor 5%)", () => {
    // trailing level = max(10 * 0.75, 5) = max(7.5, 5) = 7.5
    expect(shouldTriggerTrailingStop({
      maxPnlPercent: 10,
      pnlPercent: 4,
    })).toBe(true);
  });
});

// =============================================================================
// formatTrailingStopReason — exit_reason 문자열 생성
// =============================================================================

describe("formatTrailingStopReason", () => {
  it("tier가 있을 때 상세 포맷을 반환한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 27.4, pnlPercent: 15.0 });
    expect(reason).toContain("trailing_stop");
    expect(reason).toContain("maxPnL 27.4%");
    expect(reason).toContain("현재 15.0%");
    expect(reason).toContain("tier 20%+");
  });

  it("tier가 없을 때 간략 포맷을 반환한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 1.0, pnlPercent: 0.5 });
    expect(reason).toBe("trailing_stop: maxPnL 1.0%");
  });

  it("5%+ tier에서 올바른 되돌림 비율을 표시한다", () => {
    const reason = formatTrailingStopReason({ maxPnlPercent: 7, pnlPercent: 3 });
    expect(reason).toContain("30%");
    expect(reason).toContain("floor 1%");
  });
});

// =============================================================================
// PROFIT_TIERS — 상수 무결성 검증
// =============================================================================

describe("PROFIT_TIERS", () => {
  it("minMaxPnl 내림차순으로 정렬되어 있다", () => {
    for (let i = 0; i < PROFIT_TIERS.length - 1; i++) {
      expect(PROFIT_TIERS[i].minMaxPnl).toBeGreaterThan(PROFIT_TIERS[i + 1].minMaxPnl);
    }
  });

  it("4개 tier가 존재한다", () => {
    expect(PROFIT_TIERS).toHaveLength(4);
  });

  it("모든 tier의 retracement는 0~1 사이다", () => {
    for (const tier of PROFIT_TIERS) {
      expect(tier.retracement).toBeGreaterThan(0);
      expect(tier.retracement).toBeLessThanOrEqual(1);
    }
  });

  it("모든 tier의 profitFloor는 0 이상이다", () => {
    for (const tier of PROFIT_TIERS) {
      expect(tier.profitFloor).toBeGreaterThanOrEqual(0);
    }
  });
});

// =============================================================================
// backfillPhase2Since — phase2_since null 자동 백필 (#796)
// =============================================================================

function makeTrackedStockRow(overrides: Partial<TrackedStockRow>): TrackedStockRow {
  return {
    id: 1,
    symbol: "TEST",
    source: "agent",
    tier: "standard",
    entry_date: "2026-04-01",
    entry_price: "100",
    entry_phase: 2,
    entry_prev_phase: null,
    entry_rs_score: null,
    entry_sepa_grade: null,
    entry_thesis_id: null,
    entry_sector: null,
    entry_industry: null,
    entry_reason: null,
    phase2_since: null,
    status: "ACTIVE",
    market_regime: null,
    current_price: null,
    current_phase: null,
    current_rs_score: null,
    pnl_percent: null,
    max_pnl_percent: null,
    days_tracked: 0,
    last_updated: null,
    return_7d: null,
    return_30d: null,
    return_90d: null,
    tracking_end_date: "2026-07-01",
    phase_trajectory: null,
    sector_relative_perf: null,
    exit_date: null,
    exit_reason: null,
    ...overrides,
  };
}

describe("backfillPhase2Since", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("phase2_since가 null인 종목만 조회하고 결과를 업데이트한다", async () => {
    const items: TrackedStockRow[] = [
      makeTrackedStockRow({ id: 1, symbol: "LITE", phase2_since: null }),
      makeTrackedStockRow({ id: 2, symbol: "AAPL", phase2_since: "2026-03-01" }),
      makeTrackedStockRow({ id: 3, symbol: "AAOI", phase2_since: null }),
    ];

    mockFindPhase2SinceDates.mockResolvedValue([
      { symbol: "LITE", phase2_since: "2026-03-15" },
      { symbol: "AAOI", phase2_since: "2026-03-20" },
    ]);
    mockUpdatePhase2Since.mockResolvedValue(undefined);

    const count = await backfillPhase2Since(items, "2026-04-10");

    expect(count).toBe(2);
    expect(mockFindPhase2SinceDates).toHaveBeenCalledWith(["LITE", "AAOI"], "2026-04-10");
    expect(mockUpdatePhase2Since).toHaveBeenCalledWith(1, "2026-03-15");
    expect(mockUpdatePhase2Since).toHaveBeenCalledWith(3, "2026-03-20");
  });

  it("Phase 2가 아닌 종목은 findPhase2SinceDates 결과에 미포함되므로 null 유지", async () => {
    const items: TrackedStockRow[] = [
      makeTrackedStockRow({ id: 1, symbol: "AXTI", phase2_since: null }),
    ];

    // Phase 2가 아닌 종목은 결과에 포함되지 않음
    mockFindPhase2SinceDates.mockResolvedValue([]);
    mockUpdatePhase2Since.mockResolvedValue(undefined);

    const count = await backfillPhase2Since(items, "2026-04-10");

    expect(count).toBe(0);
    expect(mockUpdatePhase2Since).not.toHaveBeenCalled();
  });

  it("모든 종목에 phase2_since가 있으면 DB 조회를 하지 않는다", async () => {
    const items: TrackedStockRow[] = [
      makeTrackedStockRow({ id: 1, symbol: "AAPL", phase2_since: "2026-03-01" }),
      makeTrackedStockRow({ id: 2, symbol: "MSFT", phase2_since: "2026-02-15" }),
    ];

    const count = await backfillPhase2Since(items, "2026-04-10");

    expect(count).toBe(0);
    expect(mockFindPhase2SinceDates).not.toHaveBeenCalled();
    expect(mockUpdatePhase2Since).not.toHaveBeenCalled();
  });

  it("빈 배열이면 아무 작업도 하지 않는다", async () => {
    const count = await backfillPhase2Since([], "2026-04-10");

    expect(count).toBe(0);
    expect(mockFindPhase2SinceDates).not.toHaveBeenCalled();
  });
});
