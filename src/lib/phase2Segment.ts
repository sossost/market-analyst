/**
 * Phase 2 경과일 구간 분류 유틸리티.
 *
 * tracked_stocks.phase2_since (Phase 2 연속 진입 시작일)로부터
 * 경과일을 계산하고 구간(초입/진행/확립)을 분류한다.
 *
 * Weinstein Phase 2 분석 기준:
 * - 초입(1~5일): MA150 상향 돌파 직후, 최고 리스크/리워드 비율
 * - 진행(6~20일): 약 1개월 거래일, 추세 확인 최소 기간
 * - 확립(21일+): 가격에 이미 반영, 초입 대비 우위 감소
 */

/** Phase 2 구간 분류 레이블 */
export type Phase2Segment = "초입" | "진행" | "확립";

/** 구간 경계 상수 (거래일 기준) */
const PHASE2_EARLY_MAX_DAYS = 5;
const PHASE2_PROGRESSING_MAX_DAYS = 20;

/**
 * 경과일로부터 Phase 2 구간을 분류한다.
 * @param days - phase2_since로부터의 경과 일수 (양수)
 * @returns 구간 레이블
 */
export function classifyPhase2Segment(days: number): Phase2Segment {
  if (days <= PHASE2_EARLY_MAX_DAYS) {
    return "초입";
  }
  if (days <= PHASE2_PROGRESSING_MAX_DAYS) {
    return "진행";
  }
  return "확립";
}

/**
 * phase2_since 날짜와 기준일로부터 경과일을 계산한다.
 * @param phase2Since - Phase 2 시작일 (YYYY-MM-DD)
 * @param asOfDate - 기준일 (YYYY-MM-DD). 생략 시 오늘.
 * @returns 경과 일수 (최소 1). phase2Since가 null이면 null.
 */
export function computePhase2SinceDays(
  phase2Since: string | null,
  asOfDate?: string,
): number | null {
  if (phase2Since == null) {
    return null;
  }

  const sinceMs = new Date(phase2Since).getTime();
  const asOfMs = asOfDate != null
    ? new Date(asOfDate).getTime()
    : new Date(new Date().toISOString().substring(0, 10)).getTime();

  if (Number.isNaN(sinceMs) || Number.isNaN(asOfMs)) {
    return null;
  }

  const MS_PER_DAY = 86_400_000;
  const days = Math.floor((asOfMs - sinceMs) / MS_PER_DAY) + 1;

  return Math.max(days, 1);
}

/**
 * phase2_since로부터 경과일과 구간 분류를 한번에 계산한다.
 * @returns { days, segment } 또는 phase2_since가 null이면 null.
 */
export function getPhase2SegmentInfo(
  phase2Since: string | null,
  asOfDate?: string,
): { days: number; segment: Phase2Segment } | null {
  const days = computePhase2SinceDays(phase2Since, asOfDate);
  if (days == null) {
    return null;
  }
  return { days, segment: classifyPhase2Segment(days) };
}
