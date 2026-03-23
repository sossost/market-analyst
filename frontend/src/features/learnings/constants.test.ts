import { describe, it, expect } from 'vitest'

import {
  CATEGORY_LABEL,
  VERIFICATION_PATH_LABEL,
  ACTIVE_FILTER_LABEL,
  isLearningCategory,
  isVerificationPath,
  isActiveFilter,
} from './constants'

describe('CATEGORY_LABEL', () => {
  it('모든 카테고리에 라벨이 존재한다', () => {
    for (const category of ['confirmed', 'caution'] as const) {
      expect(CATEGORY_LABEL[category]).toBeDefined()
      expect(CATEGORY_LABEL[category].length).toBeGreaterThan(0)
    }
  })
})

describe('VERIFICATION_PATH_LABEL', () => {
  it('모든 검증 경로에 라벨이 존재한다', () => {
    for (const path of ['quantitative', 'llm', 'mixed'] as const) {
      expect(VERIFICATION_PATH_LABEL[path]).toBeDefined()
      expect(VERIFICATION_PATH_LABEL[path].length).toBeGreaterThan(0)
    }
  })
})

describe('ACTIVE_FILTER_LABEL', () => {
  it('모든 필터 옵션에 라벨이 존재한다', () => {
    for (const filter of ['active', 'inactive', 'all'] as const) {
      expect(ACTIVE_FILTER_LABEL[filter]).toBeDefined()
      expect(ACTIVE_FILTER_LABEL[filter].length).toBeGreaterThan(0)
    }
  })
})

describe('isLearningCategory', () => {
  it('유효한 카테고리에 true를 반환한다', () => {
    expect(isLearningCategory('confirmed')).toBe(true)
    expect(isLearningCategory('caution')).toBe(true)
  })

  it('유효하지 않은 값에 false를 반환한다', () => {
    expect(isLearningCategory('invalid')).toBe(false)
    expect(isLearningCategory('')).toBe(false)
    expect(isLearningCategory(null)).toBe(false)
    expect(isLearningCategory(undefined)).toBe(false)
    expect(isLearningCategory(123)).toBe(false)
  })
})

describe('isVerificationPath', () => {
  it('유효한 검증 경로에 true를 반환한다', () => {
    expect(isVerificationPath('quantitative')).toBe(true)
    expect(isVerificationPath('llm')).toBe(true)
    expect(isVerificationPath('mixed')).toBe(true)
  })

  it('유효하지 않은 값에 false를 반환한다', () => {
    expect(isVerificationPath('invalid')).toBe(false)
    expect(isVerificationPath(null)).toBe(false)
    expect(isVerificationPath(42)).toBe(false)
  })
})

describe('isActiveFilter', () => {
  it('유효한 필터 값에 true를 반환한다', () => {
    expect(isActiveFilter('active')).toBe(true)
    expect(isActiveFilter('inactive')).toBe(true)
    expect(isActiveFilter('all')).toBe(true)
  })

  it('유효하지 않은 값에 false를 반환한다', () => {
    expect(isActiveFilter('invalid')).toBe(false)
    expect(isActiveFilter(null)).toBe(false)
  })
})
