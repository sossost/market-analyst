/**
 * watchlistSelection.test.ts — 주간 리포트 관심종목 선별 유틸리티 테스트
 */

import { describe, it, expect } from "vitest";
import {
  calcSelectionScore,
  selectWeeklyWatchlist,
  WEEKLY_WATCHLIST_MAX,
  WEEKLY_SPOTLIGHT_COUNT,
} from "../watchlistSelection";
import type { WatchlistItem } from "@/tools/schemas/weeklyReportSchema";

function makeWatchlistItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    symbol: "AAPL",
    entryDate: "2026-01-01",
    trackingEndDate: null,
    daysTracked: 21,
    entryPhase: 2,
    currentPhase: 2,
    entryRsScore: 70,
    currentRsScore: 75,
    entrySector: "Technology",
    entryIndustry: "Software",
    entrySepaGrade: "A",
    priceAtEntry: 150,
    currentPrice: 160,
    pnlPercent: 6.67,
    maxPnlPercent: 8.0,
    sectorRelativePerf: 5,
    phaseTrajectory: [],
    entryReason: "테스트",
    hasThesisBasis: false,
    phase2Since: null,
    phase2SinceDays: null,
    phase2Segment: null,
    ...overrides,
  };
}

// ─── calcSelectionScore 테스트 ───────────────────────────────────────────────

describe("calcSelectionScore", () => {
  it("기본 종목은 0점", () => {
    const item = makeWatchlistItem();
    expect(calcSelectionScore(item)).toBe(0);
  });

  it("featured tier면 +100점", () => {
    const item = makeWatchlistItem({ tier: "featured" });
    expect(calcSelectionScore(item)).toBe(100);
  });

  it("recentPhase2Streak 14일 이상이면 +50점", () => {
    const item = makeWatchlistItem({ recentPhase2Streak: 14 });
    expect(calcSelectionScore(item)).toBe(50);
  });

  it("recentPhase2Streak 7~13일이면 +30점", () => {
    const item = makeWatchlistItem({ recentPhase2Streak: 10 });
    expect(calcSelectionScore(item)).toBe(30);
  });

  it("recentPhase2Streak 6일 이하면 streak 점수 0", () => {
    const item = makeWatchlistItem({ recentPhase2Streak: 5 });
    expect(calcSelectionScore(item)).toBe(0);
  });

  it("detectionLag 5일 이하면 +20점", () => {
    const item = makeWatchlistItem({ detectionLag: 3 });
    expect(calcSelectionScore(item)).toBe(20);
  });

  it("detectionLag 6일 이상이면 lag 점수 0", () => {
    const item = makeWatchlistItem({ detectionLag: 8 });
    expect(calcSelectionScore(item)).toBe(0);
  });

  it("detectionLag null이면 lag 점수 0", () => {
    const item = makeWatchlistItem({ detectionLag: null });
    expect(calcSelectionScore(item)).toBe(0);
  });

  it("detectionLag 음수(데이터 이상)면 lag 점수 0", () => {
    const item = makeWatchlistItem({ detectionLag: -5 });
    expect(calcSelectionScore(item)).toBe(0);
  });

  it("모든 조건 충족 시 합산: featured(100) + streak14(50) + lag3(20) = 170", () => {
    const item = makeWatchlistItem({
      tier: "featured",
      recentPhase2Streak: 14,
      detectionLag: 3,
    });
    expect(calcSelectionScore(item)).toBe(170);
  });
});

// ─── selectWeeklyWatchlist 테스트 ────────────────────────────────────────────

describe("selectWeeklyWatchlist", () => {
  it("S/A 등급만 필터링한다", () => {
    const items = [
      makeWatchlistItem({ symbol: "AAPL", entrySepaGrade: "A" }),
      makeWatchlistItem({ symbol: "MSFT", entrySepaGrade: "B" }),
      makeWatchlistItem({ symbol: "NVDA", entrySepaGrade: "S" }),
    ];
    const result = selectWeeklyWatchlist(items);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.symbol)).toEqual(expect.arrayContaining(["AAPL", "NVDA"]));
  });

  it("선별 점수 내림차순으로 정렬한다", () => {
    const items = [
      makeWatchlistItem({ symbol: "LOW", entrySepaGrade: "A" }), // 0점
      makeWatchlistItem({ symbol: "HIGH", entrySepaGrade: "S", tier: "featured" }), // 100점
      makeWatchlistItem({ symbol: "MID", entrySepaGrade: "A", recentPhase2Streak: 14 }), // 50점
    ];
    const result = selectWeeklyWatchlist(items);
    expect(result[0].symbol).toBe("HIGH");
    expect(result[1].symbol).toBe("MID");
    expect(result[2].symbol).toBe("LOW");
  });

  it("selectionScore가 결과에 포함된다", () => {
    const items = [
      makeWatchlistItem({ entrySepaGrade: "A", tier: "featured" }),
    ];
    const result = selectWeeklyWatchlist(items);
    expect(result[0].selectionScore).toBe(100);
  });

  it("빈 배열 입력 시 빈 배열 반환", () => {
    const result = selectWeeklyWatchlist([]);
    expect(result).toHaveLength(0);
  });

  it("entrySepaGrade null인 종목은 제외", () => {
    const items = [
      makeWatchlistItem({ symbol: "AAPL", entrySepaGrade: null }),
    ];
    const result = selectWeeklyWatchlist(items);
    expect(result).toHaveLength(0);
  });
});

// ─── 상수 검증 ──────────────────────────────────────────────────────────────

describe("상수 값", () => {
  it("WEEKLY_WATCHLIST_MAX는 12", () => {
    expect(WEEKLY_WATCHLIST_MAX).toBe(12);
  });

  it("WEEKLY_SPOTLIGHT_COUNT는 7", () => {
    expect(WEEKLY_SPOTLIGHT_COUNT).toBe(7);
  });
});
