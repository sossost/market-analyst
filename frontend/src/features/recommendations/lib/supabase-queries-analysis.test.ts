import { createClient } from '@/features/auth/lib/supabase-server'

import { fetchAnalysisReport } from './supabase-queries'

vi.mock('@/features/auth/lib/supabase-server', () => ({
  createClient: vi.fn(),
}))

const mockedCreateClient = vi.mocked(createClient)

function createMockChainable(response: {
  data?: unknown
  error?: unknown
}) {
  const terminal = {
    data: response.data ?? null,
    error: response.error ?? null,
  }

  const chainable: Record<string, ReturnType<typeof vi.fn>> = {}

  chainable.select = vi.fn().mockReturnValue(chainable)
  chainable.eq = vi.fn().mockReturnValue(chainable)
  chainable.single = vi.fn().mockResolvedValue(terminal)

  return chainable
}

function setupMockClient(response: { data?: unknown; error?: unknown }) {
  const chainable = createMockChainable(response)
  const client = { from: vi.fn().mockReturnValue(chainable) }
  mockedCreateClient.mockResolvedValue(client as never)
  return { client, chainable }
}

describe('fetchAnalysisReport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 매핑 (snake_case → camelCase)', async () => {
    const mockData = {
      id: 1,
      symbol: 'NVDA',
      recommendation_date: '2026-03-14',
      investment_summary: '투자 포인트 요약 내용',
      technical_analysis: '기술적 분석 내용',
      fundamental_trend: '실적 트렌드 내용',
      valuation_analysis: '밸류에이션 분석 내용',
      sector_positioning: '섹터 포지셔닝 내용',
      market_context: '시장 맥락 내용',
      risk_factors: '리스크 요인 내용',
      earnings_call_highlights: 'CEO가 가이던스를 상향했다',
      generated_at: '2026-03-14T10:00:00+00:00',
    }

    setupMockClient({ data: mockData })

    const result = await fetchAnalysisReport('NVDA', '2026-03-14')

    expect(result).toEqual({
      id: 1,
      symbol: 'NVDA',
      recommendationDate: '2026-03-14',
      investmentSummary: '투자 포인트 요약 내용',
      technicalAnalysis: '기술적 분석 내용',
      fundamentalTrend: '실적 트렌드 내용',
      valuationAnalysis: '밸류에이션 분석 내용',
      sectorPositioning: '섹터 포지셔닝 내용',
      marketContext: '시장 맥락 내용',
      riskFactors: '리스크 요인 내용',
      earningsCallHighlights: 'CEO가 가이던스를 상향했다',
      generatedAt: '2026-03-14T10:00:00+00:00',
    })
  })

  it('earnings_call_highlights가 null이면 earningsCallHighlights를 null로 매핑한다', async () => {
    const mockData = {
      id: 1,
      symbol: 'NVDA',
      recommendation_date: '2026-03-14',
      investment_summary: '투자 포인트 요약 내용',
      technical_analysis: '기술적 분석 내용',
      fundamental_trend: '실적 트렌드 내용',
      valuation_analysis: '밸류에이션 분석 내용',
      sector_positioning: '섹터 포지셔닝 내용',
      market_context: '시장 맥락 내용',
      risk_factors: '리스크 요인 내용',
      earnings_call_highlights: null,
      generated_at: '2026-03-14T10:00:00+00:00',
    }

    setupMockClient({ data: mockData })

    const result = await fetchAnalysisReport('NVDA', '2026-03-14')

    expect(result?.earningsCallHighlights).toBeNull()
  })

  it('PGRST116 에러 → null 반환 (리포트 미생성 종목)', async () => {
    setupMockClient({
      error: { code: 'PGRST116', message: 'no rows returned' },
    })

    const result = await fetchAnalysisReport('UNKNOWN', '2026-03-14')

    expect(result).toBeNull()
  })

  it('기타 DB 에러 → Error throw', async () => {
    setupMockClient({
      error: { code: 'PGRST000', message: 'connection refused' },
    })

    await expect(fetchAnalysisReport('NVDA', '2026-03-14')).rejects.toThrow(
      '기업 분석 리포트 조회 실패: connection refused',
    )
  })

  it('data null이면 null 반환', async () => {
    setupMockClient({ data: null, error: null })

    const result = await fetchAnalysisReport('NVDA', '2026-03-14')

    expect(result).toBeNull()
  })

  it('symbol과 recommendation_date로 eq 쿼리 호출', async () => {
    const { chainable } = setupMockClient({ data: null, error: null })

    await fetchAnalysisReport('AAPL', '2026-01-10')

    expect(chainable.eq).toHaveBeenCalledWith('symbol', 'AAPL')
    expect(chainable.eq).toHaveBeenCalledWith('recommendation_date', '2026-01-10')
  })
})
