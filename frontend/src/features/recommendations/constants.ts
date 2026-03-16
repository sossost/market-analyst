import type { RecommendationStatus } from './types'

export const ITEMS_PER_PAGE = 20

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> =
  {
    ACTIVE: '보유 중',
    CLOSED: '목표 달성',
    CLOSED_PHASE_EXIT: '상승 이탈',
    STOPPED: '손절 종료',
  }

export const PHASE_LABEL: Record<number, string> = {
  1: '하락 구간',
  2: '상승 초입',
  3: '상승 중반',
  4: '고점 이탈',
  5: '하락 구간',
}

export const REGIME_LABEL: Record<string, string> = {
  EARLY_BULL: '강세 초입',
  BULL: '강세',
  LATE_BULL: '강세 후반',
  EARLY_BEAR: '약세 전환 초기',
  BEAR: '약세',
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
