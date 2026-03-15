import { createClient } from '@/features/auth/lib/supabase-server'

import {
  fetchLatestDailyReport,
  fetchActiveTheses,
  fetchActiveRecommendations,
  fetchRecentRegimes,
  calculateRecommendationStats,
} from './supabase-queries'
import type { RecommendationSummary } from '../types'

vi.mock('@/features/auth/lib/supabase-server', () => ({
  createClient: vi.fn(),
}))

const mockedCreateClient = vi.mocked(createClient)

function createMockChainable(response: {
  data?: unknown
  error?: unknown
  count?: number | null
}) {
  const terminal = {
    data: response.data ?? null,
    error: response.error ?? null,
    count: response.count ?? null,
  }

  const chainable: Record<string, ReturnType<typeof vi.fn>> = {}

  chainable.select = vi.fn().mockReturnValue(chainable)
  chainable.order = vi.fn().mockReturnValue(chainable)
  chainable.eq = vi.fn().mockReturnValue(chainable)
  chainable.limit = vi.fn().mockReturnValue(chainable)
  chainable.range = vi.fn().mockResolvedValue(terminal)
  chainable.single = vi.fn().mockResolvedValue(terminal)
  chainable.maybeSingle = vi.fn().mockResolvedValue(terminal)

  return chainable
}

function setupMockClient(response: {
  data?: unknown
  error?: unknown
  count?: number | null
}) {
  const chainable = createMockChainable(response)
  const client = { from: vi.fn().mockReturnValue(chainable) }
  mockedCreateClient.mockResolvedValue(client as never)
  return { client, chainable }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchLatestDailyReport', () => {
  it('정상 데이터 반환 시 DashboardReport 매핑', async () => {
    const mockData = {
      id: 1,
      report_date: '2026-03-11',
      reported_symbols: ['AAPL', 'TSLA'],
      market_summary: {
        phase2Ratio: 42.5,
        leadingSectors: ['Technology', 'Healthcare'],
        totalAnalyzed: 500,
      },
    }

    setupMockClient({ data: mockData })

    const result = await fetchLatestDailyReport()

    expect(result).toEqual({
      id: 1,
      reportDate: '2026-03-11',
      phase2Ratio: 42.5,
      leadingSectors: ['Technology', 'Healthcare'],
      totalAnalyzed: 500,
      symbolCount: 2,
    })
  })

  it('data가 null이면 null 반환', async () => {
    setupMockClient({ data: null })

    const result = await fetchLatestDailyReport()

    expect(result).toBeNull()
  })

  it('DB 에러 시 Error throw', async () => {
    setupMockClient({ error: { message: 'connection refused' } })

    await expect(fetchLatestDailyReport()).rejects.toThrow(
      '최신 리포트 조회 실패: connection refused',
    )
  })

  it('market_summary 필드 없으면 기본값 반환', async () => {
    const mockData = {
      id: 1,
      report_date: '2026-03-11',
      reported_symbols: null,
      market_summary: null,
    }

    setupMockClient({ data: mockData })

    const result = await fetchLatestDailyReport()

    expect(result).not.toBeNull()
    expect(result!.phase2Ratio).toBe(0)
    expect(result!.leadingSectors).toEqual([])
    expect(result!.totalAnalyzed).toBe(0)
    expect(result!.symbolCount).toBe(0)
  })
})

describe('fetchActiveTheses', () => {
  it('ACTIVE thesis 목록 매핑', async () => {
    const mockData = [
      {
        id: 10,
        agent_persona: 'macro',
        thesis: 'Tech sector will outperform',
        timeframe_days: 30,
        confidence: 'high',
        consensus_level: 'strong',
        category: 'sector',
        status: 'ACTIVE',
        next_bottleneck: 'Fed decision',
        dissent_reason: null,
      },
    ]

    setupMockClient({ data: mockData, count: 1 })

    const result = await fetchActiveTheses()

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({
      id: 10,
      agentPersona: 'macro',
      thesis: 'Tech sector will outperform',
      timeframeDays: 30,
      confidence: 'high',
      consensusLevel: 'strong',
      category: 'sector',
      status: 'ACTIVE',
      nextBottleneck: 'Fed decision',
      dissentReason: null,
    })
    expect(result.totalCount).toBe(1)
  })

  it('count가 있으면 totalCount에 실제 DB 총합 반영', async () => {
    const mockData = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      agent_persona: 'macro',
      thesis: `Thesis ${i}`,
      timeframe_days: 30,
      confidence: 'high',
      consensus_level: 'strong',
      category: 'sector',
      status: 'ACTIVE',
      next_bottleneck: null,
      dissent_reason: null,
    }))

    setupMockClient({ data: mockData, count: 15 })

    const result = await fetchActiveTheses()

    expect(result.items).toHaveLength(10)
    expect(result.totalCount).toBe(15)
  })

  it('data가 null이면 빈 items 배열 반환', async () => {
    setupMockClient({ data: null, count: 0 })

    const result = await fetchActiveTheses()

    expect(result.items).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it('DB 에러 시 Error throw', async () => {
    setupMockClient({ error: { message: 'query failed' } })

    await expect(fetchActiveTheses()).rejects.toThrow(
      'Active thesis 조회 실패: query failed',
    )
  })
})

describe('fetchActiveRecommendations', () => {
  it('ACTIVE 추천 목록 매핑', async () => {
    const mockData = [
      {
        id: 1,
        symbol: 'NVDA',
        sector: 'Technology',
        pnl_percent: '35.5',
        max_pnl_percent: '42.0',
        days_held: 15,
        current_phase: 2,
      },
      {
        id: 2,
        symbol: 'TSLA',
        sector: null,
        pnl_percent: null,
        max_pnl_percent: null,
        days_held: null,
        current_phase: null,
      },
    ]

    setupMockClient({ data: mockData })

    const result = await fetchActiveRecommendations()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 1,
      symbol: 'NVDA',
      sector: 'Technology',
      pnlPercent: 35.5,
      maxPnlPercent: 42.0,
      daysHeld: 15,
      currentPhase: 2,
    })
    expect(result[1]).toEqual({
      id: 2,
      symbol: 'TSLA',
      sector: null,
      pnlPercent: null,
      maxPnlPercent: null,
      daysHeld: 0,
      currentPhase: null,
    })
  })

  it('DB 에러 시 Error throw', async () => {
    setupMockClient({ error: { message: 'permission denied' } })

    await expect(fetchActiveRecommendations()).rejects.toThrow(
      '활성 추천 종목 조회 실패: permission denied',
    )
  })
})

describe('fetchRecentRegimes', () => {
  it('최근 레짐 목록 매핑', async () => {
    const mockData = [
      {
        regime_date: '2026-03-11',
        regime: 'EARLY_BULL',
        rationale: 'Strong momentum across sectors',
        confidence: 'high',
      },
    ]

    setupMockClient({ data: mockData })

    const result = await fetchRecentRegimes()

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      regimeDate: '2026-03-11',
      regime: 'EARLY_BULL',
      rationale: 'Strong momentum across sectors',
      confidence: 'high',
    })
  })

  it('data가 null이면 빈 배열 반환', async () => {
    setupMockClient({ data: null })

    const result = await fetchRecentRegimes()

    expect(result).toEqual([])
  })

  it('DB 에러 시 Error throw', async () => {
    setupMockClient({ error: { message: 'timeout' } })

    await expect(fetchRecentRegimes()).rejects.toThrow(
      '최근 레짐 조회 실패: timeout',
    )
  })
})

describe('calculateRecommendationStats', () => {
  function createItem(
    overrides: Partial<RecommendationSummary> = {},
  ): RecommendationSummary {
    return {
      id: 1,
      symbol: 'AAPL',
      sector: 'Technology',
      pnlPercent: 10,
      maxPnlPercent: 15,
      daysHeld: 10,
      currentPhase: 2,
      ...overrides,
    }
  }

  it('빈 배열이면 모든 집계가 0', () => {
    const result = calculateRecommendationStats([])

    expect(result).toEqual({
      activeCount: 0,
      winRate: 0,
      avgPnlPercent: 0,
      avgDaysHeld: 0,
      topItems: [],
    })
  })

  it('승률 계산: pnl > 0인 비율', () => {
    const items = [
      createItem({ id: 1, pnlPercent: 10 }),
      createItem({ id: 2, pnlPercent: -5 }),
      createItem({ id: 3, pnlPercent: 20 }),
      createItem({ id: 4, pnlPercent: -3 }),
    ]

    const result = calculateRecommendationStats(items)

    expect(result.winRate).toBeCloseTo(50)
  })

  it('평균 수익률 계산: pnl null 제외', () => {
    const items = [
      createItem({ id: 1, pnlPercent: 10 }),
      createItem({ id: 2, pnlPercent: 20 }),
      createItem({ id: 3, pnlPercent: null }),
    ]

    const result = calculateRecommendationStats(items)

    expect(result.avgPnlPercent).toBeCloseTo(15)
  })

  it('평균 보유일 계산', () => {
    const items = [
      createItem({ id: 1, daysHeld: 10 }),
      createItem({ id: 2, daysHeld: 20 }),
    ]

    const result = calculateRecommendationStats(items)

    expect(result.avgDaysHeld).toBe(15)
  })

  it('topItems는 전체 종목을 포함', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      createItem({ id: i + 1, symbol: `STOCK${i}` }),
    )

    const result = calculateRecommendationStats(items)

    expect(result.topItems).toHaveLength(8)
  })

  it('topItems는 pnlPercent 내림차순으로 정렬', () => {
    const items = [
      createItem({ id: 1, symbol: 'LOW', pnlPercent: 5 }),
      createItem({ id: 2, symbol: 'HIGH', pnlPercent: 50 }),
      createItem({ id: 3, symbol: 'MID', pnlPercent: 20 }),
    ]

    const result = calculateRecommendationStats(items)

    expect(result.topItems[0].symbol).toBe('HIGH')
    expect(result.topItems[1].symbol).toBe('MID')
    expect(result.topItems[2].symbol).toBe('LOW')
  })

  it('activeCount는 전체 개수', () => {
    const items = [
      createItem({ id: 1 }),
      createItem({ id: 2 }),
      createItem({ id: 3 }),
    ]

    const result = calculateRecommendationStats(items)

    expect(result.activeCount).toBe(3)
  })
})
