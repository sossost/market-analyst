/**
 * update-tracked-stocks 단위 테스트.
 *
 * 순수 함수(수익률 계산, 만료 판정, Phase Exit 판정, 듀레이션 스냅샷 등)를 격리 테스트한다.
 * DB/pool은 mock 처리한다.
 *
 * Issue #773 — tracked_stocks 통합 ETL Phase 2
 * Issue #833 — Phase Exit 자동화
 */

import { describe, it, expect } from "vitest";

import {
  calculatePnlPercent,
  calculateMaxPnlPercent,
  isExpired,
  isPhaseExitTriggered,
  calculateDaysTracked,
  buildUpdatedTrajectory,
  calculateDurationReturn,
  type TrajectoryPoint,
} from "../update-tracked-stocks.js";

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
