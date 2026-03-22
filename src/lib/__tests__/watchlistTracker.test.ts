/**
 * watchlistTracker.test.ts — 90일 Phase 궤적 추적 단위 테스트
 *
 * 순수 함수만 테스트 — DB 접근 없음.
 */

import { describe, it, expect } from "vitest";
import {
  appendTrajectoryPoint,
  calculatePnlPercent,
  updateMaxPnl,
  isTrackingExpired,
  calculateTrackingEndDate,
  calculateDaysTracked,
  type TrajectoryPoint,
} from "../watchlistTracker";

// ─── appendTrajectoryPoint ────────────────────────────────────────────────────

describe("appendTrajectoryPoint", () => {
  it("빈 배열에 포인트 추가", () => {
    const result = appendTrajectoryPoint([], { date: "2026-01-01", phase: 2, rsScore: 75 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-01-01", phase: 2, rsScore: 75 });
  });

  it("기존 배열에 새 날짜 포인트 추가 (날짜 순 정렬)", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
      { date: "2026-01-03", phase: 2, rsScore: 75 },
    ];
    const result = appendTrajectoryPoint(existing, { date: "2026-01-02", phase: 2, rsScore: 73 });
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("동일 날짜 포인트가 존재하면 교체 (최신 데이터 우선)", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
    ];
    const result = appendTrajectoryPoint(existing, { date: "2026-01-01", phase: 3, rsScore: 80 });
    expect(result).toHaveLength(1);
    expect(result[0].phase).toBe(3);
    expect(result[0].rsScore).toBe(80);
  });

  it("원본 배열을 변경하지 않음 (불변성)", () => {
    const existing: TrajectoryPoint[] = [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
    ];
    const originalLength = existing.length;
    appendTrajectoryPoint(existing, { date: "2026-01-02", phase: 2, rsScore: 75 });
    expect(existing).toHaveLength(originalLength);
  });

  it("rsScore가 null인 포인트도 추가 가능", () => {
    const result = appendTrajectoryPoint([], { date: "2026-01-01", phase: 2, rsScore: null });
    expect(result[0].rsScore).toBeNull();
  });
});

// ─── calculatePnlPercent ──────────────────────────────────────────────────────

describe("calculatePnlPercent", () => {
  it("정상적인 PnL 계산", () => {
    const pnl = calculatePnlPercent(100, 110);
    expect(pnl).toBeCloseTo(10, 5);
  });

  it("손실 PnL 계산", () => {
    const pnl = calculatePnlPercent(100, 90);
    expect(pnl).toBeCloseTo(-10, 5);
  });

  it("수익률 0% 계산 (동일 가격)", () => {
    const pnl = calculatePnlPercent(100, 100);
    expect(pnl).toBeCloseTo(0, 5);
  });

  it("진입가가 null이면 null 반환", () => {
    expect(calculatePnlPercent(null, 110)).toBeNull();
  });

  it("현재가가 null이면 null 반환", () => {
    expect(calculatePnlPercent(100, null)).toBeNull();
  });

  it("진입가가 0이면 null 반환 (나눗셈 방지)", () => {
    expect(calculatePnlPercent(0, 110)).toBeNull();
  });

  it("현재가가 0이면 null 반환", () => {
    expect(calculatePnlPercent(100, 0)).toBeNull();
  });
});

// ─── updateMaxPnl ─────────────────────────────────────────────────────────────

describe("updateMaxPnl", () => {
  it("현재 PnL이 기존 max보다 크면 갱신", () => {
    expect(updateMaxPnl(10, 20)).toBe(20);
  });

  it("현재 PnL이 기존 max보다 작으면 기존 값 유지", () => {
    expect(updateMaxPnl(20, 10)).toBe(20);
  });

  it("현재 PnL이 음수이고 기존 max가 양수이면 기존 값 유지", () => {
    expect(updateMaxPnl(15, -5)).toBe(15);
  });

  it("existingMax가 null이면 currentPnl 반환", () => {
    expect(updateMaxPnl(null, 10)).toBe(10);
  });

  it("currentPnl이 null이면 existingMax 반환", () => {
    expect(updateMaxPnl(10, null)).toBe(10);
  });

  it("둘 다 null이면 null 반환", () => {
    expect(updateMaxPnl(null, null)).toBeNull();
  });

  it("동일 값이면 그 값 반환", () => {
    expect(updateMaxPnl(15, 15)).toBe(15);
  });
});

// ─── isTrackingExpired ────────────────────────────────────────────────────────

describe("isTrackingExpired", () => {
  it("현재 날짜가 tracking_end_date 이전이면 false", () => {
    expect(isTrackingExpired("2026-03-01", "2026-06-01")).toBe(false);
  });

  it("현재 날짜가 tracking_end_date와 동일하면 false (당일은 만료 아님)", () => {
    expect(isTrackingExpired("2026-06-01", "2026-06-01")).toBe(false);
  });

  it("현재 날짜가 tracking_end_date를 초과하면 true", () => {
    expect(isTrackingExpired("2026-06-02", "2026-06-01")).toBe(true);
  });

  it("tracking_end_date가 null이면 false", () => {
    expect(isTrackingExpired("2026-06-02", null)).toBe(false);
  });
});

// ─── calculateTrackingEndDate ─────────────────────────────────────────────────

describe("calculateTrackingEndDate", () => {
  it("90일 뒤 날짜를 정확히 계산", () => {
    const result = calculateTrackingEndDate("2026-01-01");
    expect(result).toBe("2026-04-01");
  });

  it("윤년 2월을 포함한 90일 계산", () => {
    // 2024년은 윤년: 2024-02-01 + 90일 = 2024-05-01
    const result = calculateTrackingEndDate("2024-02-01");
    expect(result).toBe("2024-05-01");
  });

  it("연도 경계를 넘는 90일 계산", () => {
    const result = calculateTrackingEndDate("2025-11-01");
    expect(result).toBe("2026-01-30");
  });
});

// ─── calculateDaysTracked ─────────────────────────────────────────────────────

describe("calculateDaysTracked", () => {
  it("등록일과 현재일이 같으면 0일", () => {
    expect(calculateDaysTracked("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("1일 경과", () => {
    expect(calculateDaysTracked("2026-01-01", "2026-01-02")).toBe(1);
  });

  it("30일 경과", () => {
    expect(calculateDaysTracked("2026-01-01", "2026-01-31")).toBe(30);
  });

  it("현재일이 등록일보다 이전이면 0 반환 (음수 방지)", () => {
    expect(calculateDaysTracked("2026-01-10", "2026-01-05")).toBe(0);
  });

  it("90일 정확히 계산", () => {
    expect(calculateDaysTracked("2026-01-01", "2026-04-01")).toBe(90);
  });
});
