import { describe, it, expect } from 'vitest'

import { mapRowToChainSummary, mapRowToChainDetail } from './supabase-queries'

describe('mapRowToChainSummary', () => {
  const baseRow = {
    id: 1,
    megatrend: 'AI 인프라 확장',
    demand_driver: '데이터센터 GPU 수요 급증',
    supply_chain: 'GPU → HBM → 광트랜시버 → 전력',
    bottleneck: '광트랜시버 공급 부족',
    bottleneck_identified_at: '2026-02-15T10:00:00+00:00',
    next_bottleneck: '전력 인프라 부족',
    status: 'ACTIVE',
    beneficiary_sectors: ['반도체', 'AI 인프라'],
    beneficiary_tickers: ['LITE', 'COHR'],
    linked_thesis_ids: [10, 20, 30],
    alpha_compatible: true,
  }

  it('snake_case DB 행을 camelCase NarrativeChainSummary로 매핑한다', () => {
    const result = mapRowToChainSummary(baseRow)

    expect(result).toEqual({
      id: 1,
      megatrend: 'AI 인프라 확장',
      demandDriver: '데이터센터 GPU 수요 급증',
      supplyChain: 'GPU → HBM → 광트랜시버 → 전력',
      bottleneck: '광트랜시버 공급 부족',
      bottleneckIdentifiedAt: '2026-02-15T10:00:00+00:00',
      nextBottleneck: '전력 인프라 부족',
      status: 'ACTIVE',
      beneficiarySectors: ['반도체', 'AI 인프라'],
      beneficiaryTickers: ['LITE', 'COHR'],
      linkedThesisCount: 3,
      alphaCompatible: true,
    })
  })

  it('next_bottleneck이 null이면 nextBottleneck을 null로 반환한다', () => {
    const row = { ...baseRow, next_bottleneck: null }
    const result = mapRowToChainSummary(row)
    expect(result.nextBottleneck).toBeNull()
  })

  it('유효하지 않은 status를 ACTIVE로 폴백한다', () => {
    const row = { ...baseRow, status: 'UNKNOWN' }
    const result = mapRowToChainSummary(row)
    expect(result.status).toBe('ACTIVE')
  })

  it('beneficiary_sectors가 null이면 빈 배열을 반환한다', () => {
    const row = { ...baseRow, beneficiary_sectors: null }
    const result = mapRowToChainSummary(row)
    expect(result.beneficiarySectors).toEqual([])
  })

  it('beneficiary_tickers가 null이면 빈 배열을 반환한다', () => {
    const row = { ...baseRow, beneficiary_tickers: null }
    const result = mapRowToChainSummary(row)
    expect(result.beneficiaryTickers).toEqual([])
  })

  it('linked_thesis_ids가 null이면 linkedThesisCount를 0으로 반환한다', () => {
    const row = { ...baseRow, linked_thesis_ids: null }
    const result = mapRowToChainSummary(row)
    expect(result.linkedThesisCount).toBe(0)
  })

  it('alpha_compatible가 null이면 null을 반환한다', () => {
    const row = { ...baseRow, alpha_compatible: null }
    const result = mapRowToChainSummary(row)
    expect(result.alphaCompatible).toBeNull()
  })

  it('모든 유효한 status 값을 올바르게 매핑한다', () => {
    for (const status of ['ACTIVE', 'RESOLVING', 'RESOLVED', 'OVERSUPPLY', 'INVALIDATED']) {
      const row = { ...baseRow, status }
      const result = mapRowToChainSummary(row)
      expect(result.status).toBe(status)
    }
  })
})

describe('mapRowToChainDetail', () => {
  const baseRow = {
    id: 1,
    megatrend: 'AI 인프라 확장',
    demand_driver: '데이터센터 GPU 수요 급증',
    supply_chain: 'GPU → HBM → 광트랜시버 → 전력',
    bottleneck: '광트랜시버 공급 부족',
    bottleneck_identified_at: '2026-02-15T10:00:00+00:00',
    bottleneck_resolved_at: '2026-03-10T10:00:00+00:00',
    next_bottleneck: '전력 인프라 부족',
    status: 'RESOLVED',
    beneficiary_sectors: ['반도체'],
    beneficiary_tickers: ['LITE'],
    linked_thesis_ids: [10, 20],
    alpha_compatible: true,
    resolution_days: 23,
  }

  it('summary 필드와 detail 전용 필드를 모두 포함한다', () => {
    const result = mapRowToChainDetail(baseRow)

    expect(result.bottleneckResolvedAt).toBe('2026-03-10T10:00:00+00:00')
    expect(result.linkedThesisIds).toEqual([10, 20])
    expect(result.resolutionDays).toBe(23)
    // summary fields
    expect(result.id).toBe(1)
    expect(result.megatrend).toBe('AI 인프라 확장')
    expect(result.linkedThesisCount).toBe(2)
  })

  it('bottleneck_resolved_at이 null이면 null을 반환한다', () => {
    const row = { ...baseRow, bottleneck_resolved_at: null }
    const result = mapRowToChainDetail(row)
    expect(result.bottleneckResolvedAt).toBeNull()
  })

  it('resolution_days가 null이면 null을 반환한다', () => {
    const row = { ...baseRow, resolution_days: null }
    const result = mapRowToChainDetail(row)
    expect(result.resolutionDays).toBeNull()
  })

  it('linked_thesis_ids가 null이면 빈 배열을 반환한다', () => {
    const row = { ...baseRow, linked_thesis_ids: null }
    const result = mapRowToChainDetail(row)
    expect(result.linkedThesisIds).toEqual([])
  })
})
