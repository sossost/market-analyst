/**
 * watchlistSelection — 주간 리포트 관심종목 선별 유틸리티.
 *
 * featured tier, Phase 2 연속일, detection_lag 기반으로
 * 선별 점수를 계산하고 정렬한다.
 */

import type { WatchlistItem } from "@/tools/schemas/weeklyReportSchema";

/** 선별 점수가 부여된 WatchlistItem */
export interface ScoredWatchlistItem extends WatchlistItem {
  selectionScore: number;
}

/** 주간 리포트에 표시할 최대 종목 수 */
export const WEEKLY_WATCHLIST_MAX = 12;

/** "이번 주 주목" 뱃지 부여 상위 종목 수 */
export const WEEKLY_SPOTLIGHT_COUNT = 7;

/**
 * 관심종목 선별 점수를 계산한다.
 *
 * 점수 체계:
 * - featured tier: +100
 * - Phase 2 14일+ 연속: +50 / 7일+: +30
 * - detection_lag ≤ 5일: +20
 */
export function calcSelectionScore(item: WatchlistItem): number {
  let score = 0;

  if (item.tier === "featured") {
    score += 100;
  }

  const streak = item.recentPhase2Streak ?? 0;
  if (streak >= 14) {
    score += 50;
  } else if (streak >= 7) {
    score += 30;
  }

  const lag = item.detectionLag;
  if (lag != null && lag >= 0 && lag <= 5) {
    score += 20;
  }

  return score;
}

/**
 * S/A 등급 필터 + 선별 점수 기준 정렬된 관심종목 목록을 반환한다.
 */
export function selectWeeklyWatchlist(items: WatchlistItem[]): ScoredWatchlistItem[] {
  const saItems = items.filter(
    (w) => w.entrySepaGrade === "S" || w.entrySepaGrade === "A",
  );

  const scored: ScoredWatchlistItem[] = saItems.map((w) => ({
    ...w,
    selectionScore: calcSelectionScore(w),
  }));

  scored.sort((a, b) => {
    if (b.selectionScore !== a.selectionScore) {
      return b.selectionScore - a.selectionScore;
    }
    return (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0);
  });

  return scored;
}
