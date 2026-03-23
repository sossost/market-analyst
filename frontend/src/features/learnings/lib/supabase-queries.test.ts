import { describe, it, expect } from 'vitest'

import { mapRowToLearning } from './supabase-queries'

describe('mapRowToLearning', () => {
  const baseRow = {
    id: 1,
    principle: '주도주는 섹터 초기 상승 시 RS 80 이상',
    category: 'confirmed',
    hit_count: 5,
    miss_count: 2,
    hit_rate: '0.714',
    is_active: true,
    verification_path: 'quantitative',
    first_confirmed: '2026-01-15',
    last_verified: '2026-03-20',
    expires_at: null,
    created_at: '2026-01-15T10:00:00+09:00',
  }

  it('snake_case DB 행을 camelCase AgentLearning으로 매핑한다', () => {
    const result = mapRowToLearning(baseRow)

    expect(result).toEqual({
      id: 1,
      principle: '주도주는 섹터 초기 상승 시 RS 80 이상',
      category: 'confirmed',
      hitCount: 5,
      missCount: 2,
      hitRate: 0.714,
      isActive: true,
      verificationPath: 'quantitative',
      firstConfirmed: '2026-01-15',
      lastVerified: '2026-03-20',
      expiresAt: null,
      createdAt: '2026-01-15T10:00:00+09:00',
    })
  })

  it('hit_rate가 null이면 hitRate를 null로 반환한다', () => {
    const row = { ...baseRow, hit_rate: null }
    const result = mapRowToLearning(row)
    expect(result.hitRate).toBeNull()
  })

  it('유효하지 않은 category를 confirmed로 폴백한다', () => {
    const row = { ...baseRow, category: 'unknown' }
    const result = mapRowToLearning(row)
    expect(result.category).toBe('confirmed')
  })

  it('유효하지 않은 verification_path를 null로 폴백한다', () => {
    const row = { ...baseRow, verification_path: 'invalid' }
    const result = mapRowToLearning(row)
    expect(result.verificationPath).toBeNull()
  })

  it('null 필드들을 안전하게 처리한다', () => {
    const row = {
      ...baseRow,
      first_confirmed: null,
      last_verified: null,
      expires_at: null,
      verification_path: null,
    }
    const result = mapRowToLearning(row)
    expect(result.firstConfirmed).toBeNull()
    expect(result.lastVerified).toBeNull()
    expect(result.expiresAt).toBeNull()
    expect(result.verificationPath).toBeNull()
  })

  it('hit_rate 문자열을 숫자로 변환한다', () => {
    const row = { ...baseRow, hit_rate: '0.850' }
    const result = mapRowToLearning(row)
    expect(result.hitRate).toBe(0.85)
  })

  it('caution 카테고리를 올바르게 매핑한다', () => {
    const row = { ...baseRow, category: 'caution' }
    const result = mapRowToLearning(row)
    expect(result.category).toBe('caution')
  })

  it('모든 verification_path 값을 올바르게 매핑한다', () => {
    for (const path of ['quantitative', 'llm', 'mixed'] as const) {
      const row = { ...baseRow, verification_path: path }
      const result = mapRowToLearning(row)
      expect(result.verificationPath).toBe(path)
    }
  })
})
