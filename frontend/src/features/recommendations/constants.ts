import type { RecommendationStatus } from './types'

export const ITEMS_PER_PAGE = 20

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> =
  {
    ACTIVE: '보유 중',
    CLOSED: '종료',
    CLOSED_PHASE_EXIT: '하락 전환',
    STOPPED: '손절',
  }

export const RECOMMENDATION_STATUS_TOOLTIP: Record<
  RecommendationStatus,
  string
> = {
  ACTIVE: '현재 보유 중인 추천 종목',
  CLOSED: '재추천 또는 전략 기준에 의해 포지션 종료',
  CLOSED_PHASE_EXIT: '상승 흐름이 하락으로 전환되어 자동 매도',
  STOPPED: '손절 기준에 도달하여 종료',
}

export const PHASE_LABEL: Record<number, string> = {
  1: '바닥 횡보',
  2: '상승 초입',
  3: '고점 형성',
  4: '하락 전환',
  5: '본격 하락',
}

export const PHASE_TOOLTIP: Record<number, string> = {
  1: '하락이 멈추고 바닥을 다지는 구간',
  2: '상승 추세가 시작된 구간 — 진입 적기',
  3: '상승 에너지가 줄고 고점을 형성하는 구간',
  4: '고점을 지나 하락 추세로 전환',
  5: '뚜렷한 하락 추세 진행 중',
}

export const REGIME_LABEL: Record<string, string> = {
  EARLY_BULL: '강세 초입',
  BULL: '강세',
  LATE_BULL: '강세 후반',
  EARLY_BEAR: '약세 전환',
  BEAR: '약세',
}

export const REGIME_TOOLTIP: Record<string, string> = {
  EARLY_BULL: '시장이 강세로 전환하는 초기 단계',
  BULL: '시장 전체가 뚜렷한 상승 추세',
  LATE_BULL: '강세가 지속 중이나 에너지가 줄어드는 단계',
  EARLY_BEAR: '시장이 약세로 전환하기 시작 — 신규 진입 주의',
  BEAR: '시장 전체가 하락 추세 — 방어적 전략 필요',
}

const VALID_RECOMMENDATION_STATUSES = new Set<string>([
  'ACTIVE',
  'CLOSED',
  'CLOSED_PHASE_EXIT',
  'STOPPED',
])

export function isRecommendationStatus(
  value: unknown,
): value is RecommendationStatus {
  return (
    typeof value === 'string' && VALID_RECOMMENDATION_STATUSES.has(value)
  )
}
