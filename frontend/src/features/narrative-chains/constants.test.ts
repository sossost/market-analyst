import { describe, it, expect } from 'vitest'

import {
  CHAIN_STATUS_LABEL,
  CHAIN_STATUS_VARIANT,
  isNarrativeChainStatus,
} from './constants'

const ALL_STATUSES = [
  'ACTIVE',
  'RESOLVING',
  'RESOLVED',
  'OVERSUPPLY',
  'INVALIDATED',
] as const

describe('CHAIN_STATUS_LABEL', () => {
  it('모든 상태에 대해 한글 라벨이 존재한다', () => {
    for (const status of ALL_STATUSES) {
      expect(CHAIN_STATUS_LABEL[status]).toBeDefined()
      expect(CHAIN_STATUS_LABEL[status].length).toBeGreaterThan(0)
    }
  })

  it('ACTIVE를 "활성"으로 번역한다', () => {
    expect(CHAIN_STATUS_LABEL['ACTIVE']).toBe('활성')
  })

  it('RESOLVED를 "해소됨"으로 번역한다', () => {
    expect(CHAIN_STATUS_LABEL['RESOLVED']).toBe('해소됨')
  })

  it('OVERSUPPLY를 "공급 과잉"으로 번역한다', () => {
    expect(CHAIN_STATUS_LABEL['OVERSUPPLY']).toBe('공급 과잉')
  })
})

describe('CHAIN_STATUS_VARIANT', () => {
  it('모든 상태에 대해 variant가 존재한다', () => {
    for (const status of ALL_STATUSES) {
      expect(CHAIN_STATUS_VARIANT[status]).toBeDefined()
    }
  })

  it('ACTIVE는 default variant를 사용한다', () => {
    expect(CHAIN_STATUS_VARIANT['ACTIVE']).toBe('default')
  })

  it('OVERSUPPLY는 destructive variant를 사용한다', () => {
    expect(CHAIN_STATUS_VARIANT['OVERSUPPLY']).toBe('destructive')
  })
})

describe('isNarrativeChainStatus', () => {
  it('유효한 상태 값에 대해 true를 반환한다', () => {
    for (const status of ALL_STATUSES) {
      expect(isNarrativeChainStatus(status)).toBe(true)
    }
  })

  it('유효하지 않은 문자열에 대해 false를 반환한다', () => {
    expect(isNarrativeChainStatus('INVALID')).toBe(false)
    expect(isNarrativeChainStatus('')).toBe(false)
    expect(isNarrativeChainStatus('active')).toBe(false)
  })

  it('문자열이 아닌 값에 대해 false를 반환한다', () => {
    expect(isNarrativeChainStatus(null)).toBe(false)
    expect(isNarrativeChainStatus(undefined)).toBe(false)
    expect(isNarrativeChainStatus(123)).toBe(false)
    expect(isNarrativeChainStatus(true)).toBe(false)
  })
})
