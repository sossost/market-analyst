import { createClient } from '@/features/auth/lib/supabase-server'

import { fetchReports, fetchReportByDate } from './supabase-queries'

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

describe('fetchReports', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 반환 시 ReportSummary[] 매핑', async () => {
    const mockData = [
      {
        id: 1,
        report_date: '2026-03-09',
        type: 'daily',
        reported_symbols: ['AAPL', 'TSLA', 'NVDA'],
        market_summary: {
          leadingSectors: ['Technology', 'Healthcare'],
          phase2Ratio: 0.45,
        },
      },
      {
        id: 2,
        report_date: '2026-03-08',
        type: 'weekly',
        reported_symbols: ['MSFT'],
        market_summary: {
          leadingSectors: ['Financials'],
          phase2Ratio: 0.3,
        },
      },
    ]

    setupMockClient({ data: mockData, count: 42 })

    const result = await fetchReports(1)

    expect(result.total).toBe(42)
    expect(result.reports).toHaveLength(2)
    expect(result.reports[0]).toEqual({
      id: 1,
      reportDate: '2026-03-09',
      type: 'daily',
      symbolCount: 3,
      leadingSectors: ['Technology', 'Healthcare'],
      phase2Ratio: 0.45,
    })
    expect(result.reports[1]).toEqual({
      id: 2,
      reportDate: '2026-03-08',
      type: 'weekly',
      symbolCount: 1,
      leadingSectors: ['Financials'],
      phase2Ratio: 0.3,
    })
  })

  it('DB error 시 Error throw', async () => {
    setupMockClient({
      error: { message: 'connection refused' },
    })

    await expect(fetchReports(1)).rejects.toThrow(
      '리포트 목록 조회 실패: connection refused',
    )
  })

  it('data가 null이면 빈 배열 반환', async () => {
    setupMockClient({ data: null, count: 0 })

    const result = await fetchReports(1)

    expect(result.reports).toEqual([])
    expect(result.total).toBe(0)
  })

  it('page 2일 때 offset 20으로 range 호출', async () => {
    const { chainable } = setupMockClient({ data: [], count: 0 })

    await fetchReports(2)

    expect(chainable.range).toHaveBeenCalledWith(20, 39)
  })

  it('유효하지 않은 type은 daily로 폴백', async () => {
    const mockData = [
      {
        id: 1,
        report_date: '2026-03-09',
        type: 'unknown_type',
        reported_symbols: [],
        market_summary: {},
      },
    ]

    setupMockClient({ data: mockData, count: 1 })

    const result = await fetchReports(1)

    expect(result.reports[0].type).toBe('daily')
  })

  it('reported_symbols가 배열이 아니면 symbolCount 0', async () => {
    const mockData = [
      {
        id: 1,
        report_date: '2026-03-09',
        type: 'daily',
        reported_symbols: 'not-an-array',
        market_summary: {},
      },
    ]

    setupMockClient({ data: mockData, count: 1 })

    const result = await fetchReports(1)

    expect(result.reports[0].symbolCount).toBe(0)
  })

  it('market_summary에 leadingSectors/phase2Ratio 없으면 기본값', async () => {
    const mockData = [
      {
        id: 1,
        report_date: '2026-03-09',
        type: 'daily',
        reported_symbols: [],
        market_summary: {},
      },
    ]

    setupMockClient({ data: mockData, count: 1 })

    const result = await fetchReports(1)

    expect(result.reports[0].leadingSectors).toEqual([])
    expect(result.reports[0].phase2Ratio).toBe(0)
  })
})

describe('fetchReportByDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 반환 시 ReportDetail 매핑', async () => {
    const mockData = {
      id: 1,
      report_date: '2026-03-09',
      type: 'daily',
      reported_symbols: [
        {
          symbol: 'AAPL',
          phase: 2,
          prevPhase: 1,
          rsScore: 85,
          sector: 'Technology',
          industry: 'Consumer Electronics',
          reason: 'Strong momentum',
          firstReportedDate: '2026-03-01',
        },
      ],
      market_summary: {
        phase2Ratio: 0.45,
        leadingSectors: ['Technology'],
        totalAnalyzed: 500,
      },
      full_content: '# Daily Report\nContent here',
      metadata: {
        model: 'claude-sonnet-4-20250514',
        tokensUsed: { input: 1000, output: 500 },
        toolCalls: 5,
        executionTime: 30000,
      },
    }

    setupMockClient({ data: mockData })

    const result = await fetchReportByDate('2026-03-09')

    expect(result).toEqual({
      id: 1,
      reportDate: '2026-03-09',
      type: 'daily',
      reportedSymbols: mockData.reported_symbols,
      marketSummary: {
        phase2Ratio: 0.45,
        leadingSectors: ['Technology'],
        totalAnalyzed: 500,
      },
      fullContent: '# Daily Report\nContent here',
      metadata: {
        model: 'claude-sonnet-4-20250514',
        tokensUsed: { input: 1000, output: 500 },
        toolCalls: 5,
        executionTime: 30000,
      },
    })
  })

  it('PGRST116 에러 시 null 반환', async () => {
    setupMockClient({
      error: { code: 'PGRST116', message: 'no rows returned' },
    })

    const result = await fetchReportByDate('2026-03-09')

    expect(result).toBeNull()
  })

  it('기타 에러 시 Error throw', async () => {
    setupMockClient({
      error: { code: 'PGRST000', message: 'internal error' },
    })

    await expect(fetchReportByDate('2026-03-09')).rejects.toThrow(
      '리포트 상세 조회 실패: internal error',
    )
  })

  it('data가 null이면 null 반환', async () => {
    setupMockClient({ data: null, error: null })

    const result = await fetchReportByDate('2026-03-09')

    expect(result).toBeNull()
  })

  it('metadata 필드 없으면 기본값으로 채움', async () => {
    const mockData = {
      id: 1,
      report_date: '2026-03-09',
      type: 'daily',
      reported_symbols: [],
      market_summary: null,
      full_content: null,
      metadata: null,
    }

    setupMockClient({ data: mockData })

    const result = await fetchReportByDate('2026-03-09')

    expect(result).not.toBeNull()
    expect(result!.metadata).toEqual({
      model: '',
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      executionTime: 0,
    })
    expect(result!.marketSummary).toEqual({
      phase2Ratio: 0,
      leadingSectors: [],
      totalAnalyzed: 0,
    })
    expect(result!.fullContent).toBeNull()
  })
})
