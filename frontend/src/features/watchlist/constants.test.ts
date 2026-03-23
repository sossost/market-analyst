import { describe, it, expect } from 'vitest'

import {
  WATCHLIST_STATUS_LABEL,
  WATCHLIST_STATUS_TOOLTIP,
  SEPA_GRADE_LABEL,
  isWatchlistStatus,
} from './constants'

describe('WATCHLIST_STATUS_LABEL', () => {
  it('ACTIVE를 "추적 중"으로 번역한다', () => {
    expect(WATCHLIST_STATUS_LABEL['ACTIVE']).toBe('추적 중')
  })

  it('EXITED를 "종료"로 번역한다', () => {
    expect(WATCHLIST_STATUS_LABEL['EXITED']).toBe('종료')
  })

  it('모든 상태에 대해 툴팁이 존재한다', () => {
    for (const status of ['ACTIVE', 'EXITED'] as const) {
      expect(WATCHLIST_STATUS_TOOLTIP[status]).toBeDefined()
      expect(WATCHLIST_STATUS_TOOLTIP[status].length).toBeGreaterThan(0)
    }
  })
})

describe('SEPA_GRADE_LABEL', () => {
  it('모든 등급에 대해 라벨이 존재한다', () => {
    for (const grade of ['S', 'A', 'B', 'C', 'F']) {
      expect(SEPA_GRADE_LABEL[grade]).toBeDefined()
      expect(SEPA_GRADE_LABEL[grade].length).toBeGreaterThan(0)
    }
  })

  it('알 수 없는 등급은 undefined를 반환한다', () => {
    expect(SEPA_GRADE_LABEL['X']).toBeUndefined()
  })
})

describe('isWatchlistStatus', () => {
  it('유효한 상태 값에 대해 true를 반환한다', () => {
    expect(isWatchlistStatus('ACTIVE')).toBe(true)
    expect(isWatchlistStatus('EXITED')).toBe(true)
  })

  it('유효하지 않은 문자열에 대해 false를 반환한다', () => {
    expect(isWatchlistStatus('INVALID')).toBe(false)
    expect(isWatchlistStatus('')).toBe(false)
  })

  it('문자열이 아닌 값에 대해 false를 반환한다', () => {
    expect(isWatchlistStatus(null)).toBe(false)
    expect(isWatchlistStatus(undefined)).toBe(false)
    expect(isWatchlistStatus(123)).toBe(false)
  })
})
