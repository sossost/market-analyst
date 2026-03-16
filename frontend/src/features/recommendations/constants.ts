import type { RecommendationStatus } from './types'

export const ITEMS_PER_PAGE = 20

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> =
  {
    ACTIVE: '활성',
    CLOSED: '종료',
    STOPPED: '중단',
  }

const VALID_RECOMMENDATION_STATUSES = new Set<string>([
  'ACTIVE',
  'CLOSED',
  'STOPPED',
])

export function isRecommendationStatus(
  value: unknown,
): value is RecommendationStatus {
  return (
    typeof value === 'string' && VALID_RECOMMENDATION_STATUSES.has(value)
  )
}
