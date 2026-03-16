import { describe, it, expect } from 'vitest'

import {
  PHASE_LABEL,
  PHASE_TOOLTIP,
  REGIME_LABEL,
  REGIME_TOOLTIP,
  RECOMMENDATION_STATUS_LABEL,
  RECOMMENDATION_STATUS_TOOLTIP,
  isRecommendationStatus,
} from './constants'

describe('PHASE_LABEL', () => {
  it('Phase 1을 "바닥 횡보"로 번역한다', () => {
    expect(PHASE_LABEL[1]).toBe('바닥 횡보')
  })

  it('Phase 2를 "상승 초입"으로 번역한다', () => {
    expect(PHASE_LABEL[2]).toBe('상승 초입')
  })

  it('Phase 3을 "고점 형성"으로 번역한다', () => {
    expect(PHASE_LABEL[3]).toBe('고점 형성')
  })

  it('Phase 4를 "하락 전환"으로 번역한다', () => {
    expect(PHASE_LABEL[4]).toBe('하락 전환')
  })

  it('Phase 5를 "본격 하락"으로 번역한다', () => {
    expect(PHASE_LABEL[5]).toBe('본격 하락')
  })

  it('모든 Phase에 대해 툴팁이 존재한다', () => {
    for (const phase of [1, 2, 3, 4, 5]) {
      expect(PHASE_TOOLTIP[phase]).toBeDefined()
      expect(PHASE_TOOLTIP[phase].length).toBeGreaterThan(0)
    }
  })
})

describe('REGIME_LABEL', () => {
  it('EARLY_BULL을 "강세 초입"으로 번역한다', () => {
    expect(REGIME_LABEL['EARLY_BULL']).toBe('강세 초입')
  })

  it('BULL을 "강세"로 번역한다', () => {
    expect(REGIME_LABEL['BULL']).toBe('강세')
  })

  it('LATE_BULL을 "강세 후반"으로 번역한다', () => {
    expect(REGIME_LABEL['LATE_BULL']).toBe('강세 후반')
  })

  it('EARLY_BEAR를 "약세 전환"으로 번역한다', () => {
    expect(REGIME_LABEL['EARLY_BEAR']).toBe('약세 전환')
  })

  it('BEAR를 "약세"로 번역한다', () => {
    expect(REGIME_LABEL['BEAR']).toBe('약세')
  })

  it('알 수 없는 레짐 코드는 undefined를 반환한다', () => {
    expect(REGIME_LABEL['UNKNOWN_REGIME']).toBeUndefined()
  })

  it('모든 레짐에 대해 툴팁이 존재한다', () => {
    for (const regime of ['EARLY_BULL', 'BULL', 'LATE_BULL', 'EARLY_BEAR', 'BEAR']) {
      expect(REGIME_TOOLTIP[regime]).toBeDefined()
      expect(REGIME_TOOLTIP[regime].length).toBeGreaterThan(0)
    }
  })
})

describe('RECOMMENDATION_STATUS_LABEL', () => {
  it('ACTIVE를 "보유 중"으로 번역한다', () => {
    expect(RECOMMENDATION_STATUS_LABEL['ACTIVE']).toBe('보유 중')
  })

  it('CLOSED를 "종료"로 번역한다', () => {
    expect(RECOMMENDATION_STATUS_LABEL['CLOSED']).toBe('종료')
  })

  it('CLOSED_PHASE_EXIT를 "하락 전환"으로 번역한다', () => {
    expect(RECOMMENDATION_STATUS_LABEL['CLOSED_PHASE_EXIT']).toBe('하락 전환')
  })

  it('STOPPED를 "손절"로 번역한다', () => {
    expect(RECOMMENDATION_STATUS_LABEL['STOPPED']).toBe('손절')
  })

  it('모든 상태에 대해 툴팁이 존재한다', () => {
    for (const status of ['ACTIVE', 'CLOSED', 'CLOSED_PHASE_EXIT', 'STOPPED'] as const) {
      expect(RECOMMENDATION_STATUS_TOOLTIP[status]).toBeDefined()
      expect(RECOMMENDATION_STATUS_TOOLTIP[status].length).toBeGreaterThan(0)
    }
  })
})

describe('isRecommendationStatus', () => {
  it('유효한 상태 값에 대해 true를 반환한다', () => {
    expect(isRecommendationStatus('ACTIVE')).toBe(true)
    expect(isRecommendationStatus('CLOSED')).toBe(true)
    expect(isRecommendationStatus('CLOSED_PHASE_EXIT')).toBe(true)
    expect(isRecommendationStatus('STOPPED')).toBe(true)
  })

  it('유효하지 않은 문자열에 대해 false를 반환한다', () => {
    expect(isRecommendationStatus('INVALID')).toBe(false)
    expect(isRecommendationStatus('')).toBe(false)
  })

  it('문자열이 아닌 값에 대해 false를 반환한다', () => {
    expect(isRecommendationStatus(null)).toBe(false)
    expect(isRecommendationStatus(undefined)).toBe(false)
    expect(isRecommendationStatus(123)).toBe(false)
  })
})
