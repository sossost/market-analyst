import type { WatchlistStatus } from './types'

export const ITEMS_PER_PAGE = 20

export const WATCHLIST_STATUS_LABEL: Record<WatchlistStatus, string> = {
  ACTIVE: '추적 중',
  EXITED: '종료',
}

export const WATCHLIST_STATUS_TOOLTIP: Record<WatchlistStatus, string> = {
  ACTIVE: '90일 윈도우 내 Phase 궤적을 추적 중인 종목',
  EXITED: '추적 기간이 종료되었거나 조건 이탈로 해제된 종목',
}

export const SEPA_GRADE_LABEL: Record<string, string> = {
  S: 'S (최우수)',
  A: 'A (우수)',
  B: 'B (보통)',
  C: 'C (미흡)',
  F: 'F (부적격)',
}

const VALID_WATCHLIST_STATUSES = new Set<string>(['ACTIVE', 'EXITED'])

export function isWatchlistStatus(value: unknown): value is WatchlistStatus {
  return typeof value === 'string' && VALID_WATCHLIST_STATUSES.has(value)
}
