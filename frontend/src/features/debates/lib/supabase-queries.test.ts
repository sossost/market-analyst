import { createClient } from '@/features/auth/lib/supabase-server'

import {
  fetchDebateSessions,
  fetchDebateSessionByDate,
  fetchThesesByDate,
  fetchRegimeByDate,
} from './supabase-queries'

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

describe('fetchDebateSessions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 매핑 (snake_case → camelCase)', async () => {
    const mockData = [
      {
        id: 1,
        date: '2026-03-09',
        vix: '18.5',
        fear_greed_score: '45',
        phase2_ratio: '0.35',
        top_sector_rs: 'Technology',
        theses_count: 5,
      },
      {
        id: 2,
        date: '2026-03-08',
        vix: null,
        fear_greed_score: null,
        phase2_ratio: null,
        top_sector_rs: null,
        theses_count: 3,
      },
    ]

    setupMockClient({ data: mockData, count: 50 })

    const result = await fetchDebateSessions(1)

    expect(result.total).toBe(50)
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0]).toEqual({
      id: 1,
      date: '2026-03-09',
      vix: '18.5',
      fearGreedScore: '45',
      phase2Ratio: '0.35',
      topSectorRs: 'Technology',
      thesesCount: 5,
    })
    expect(result.sessions[1]).toEqual({
      id: 2,
      date: '2026-03-08',
      vix: null,
      fearGreedScore: null,
      phase2Ratio: null,
      topSectorRs: null,
      thesesCount: 3,
    })
  })

  it('DB error 시 Error throw', async () => {
    setupMockClient({
      error: { message: 'connection timeout' },
    })

    await expect(fetchDebateSessions(1)).rejects.toThrow(
      '토론 목록 조회 실패: connection timeout',
    )
  })

  it('data null이면 빈 배열', async () => {
    setupMockClient({ data: null, count: 0 })

    const result = await fetchDebateSessions(1)

    expect(result.sessions).toEqual([])
    expect(result.total).toBe(0)
  })

  it('page 2일 때 offset 20으로 range 호출', async () => {
    const { chainable } = setupMockClient({ data: [], count: 0 })

    await fetchDebateSessions(2)

    expect(chainable.range).toHaveBeenCalledWith(20, 39)
  })
})

describe('fetchDebateSessionByDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 → DebateSessionDetail 매핑', async () => {
    const mockData = {
      id: 1,
      date: '2026-03-09',
      vix: '18.5',
      fear_greed_score: '45',
      phase2_ratio: '0.35',
      top_sector_rs: 'Technology',
      theses_count: 5,
      round1_outputs: 'Round 1 content',
      round2_outputs: 'Round 2 content',
      synthesis_report: 'Synthesis content',
      market_snapshot: 'Snapshot content',
      tokens_input: 5000,
      tokens_output: 2000,
      duration_ms: 45000,
    }

    setupMockClient({ data: mockData })

    const result = await fetchDebateSessionByDate('2026-03-09')

    expect(result).toEqual({
      id: 1,
      date: '2026-03-09',
      vix: '18.5',
      fearGreedScore: '45',
      phase2Ratio: '0.35',
      topSectorRs: 'Technology',
      thesesCount: 5,
      round1Outputs: 'Round 1 content',
      round2Outputs: 'Round 2 content',
      synthesisReport: 'Synthesis content',
      marketSnapshot: 'Snapshot content',
      tokensInput: 5000,
      tokensOutput: 2000,
      durationMs: 45000,
    })
  })

  it('PGRST116 에러 → null 반환', async () => {
    setupMockClient({
      error: { code: 'PGRST116', message: 'no rows returned' },
    })

    const result = await fetchDebateSessionByDate('2026-03-09')

    expect(result).toBeNull()
  })

  it('기타 에러 → Error throw', async () => {
    setupMockClient({
      error: { code: 'PGRST000', message: 'internal error' },
    })

    await expect(fetchDebateSessionByDate('2026-03-09')).rejects.toThrow(
      '토론 상세 조회 실패: internal error',
    )
  })

  it('data null이면 null 반환', async () => {
    setupMockClient({ data: null, error: null })

    const result = await fetchDebateSessionByDate('2026-03-09')

    expect(result).toBeNull()
  })
})

describe('fetchThesesByDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 → DebateThesis[] 매핑', async () => {
    const mockData = [
      {
        id: 1,
        agent_persona: 'macro-economist',
        thesis: 'AI 섹터 강세 지속',
        timeframe_days: 30,
        confidence: 'high',
        consensus_level: 'strong_agree',
        category: 'sector',
        status: 'ACTIVE',
        next_bottleneck: '금리 인상 리스크',
        dissent_reason: null,
      },
      {
        id: 2,
        agent_persona: 'tech-analyst',
        thesis: '반도체 과열 우려',
        timeframe_days: 14,
        confidence: 'medium',
        consensus_level: 'divided',
        category: 'stock',
        status: 'CONFIRMED',
        next_bottleneck: null,
        dissent_reason: '실적 지지',
      },
    ]

    // fetchThesesByDate 체인: .eq().order().order() — 마지막이 order이므로 resolve 필요
    const chainable = createMockChainable({ data: mockData })
    // order가 두 번 호출되고 마지막 order에서 resolve 되어야 함
    chainable.order = vi.fn().mockReturnValue(chainable)
    // 마지막 체인의 then을 위해 chainable 자체를 thenable로 만듦
    const terminalPromise = Promise.resolve({
      data: mockData,
      error: null,
    })
    let orderCallCount = 0
    chainable.order = vi.fn().mockImplementation(() => {
      orderCallCount++
      if (orderCallCount >= 2) {
        return terminalPromise
      }
      return chainable
    })

    const client = { from: vi.fn().mockReturnValue(chainable) }
    mockedCreateClient.mockResolvedValue(client as never)

    const result = await fetchThesesByDate('2026-03-09')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 1,
      agentPersona: 'macro-economist',
      thesis: 'AI 섹터 강세 지속',
      timeframeDays: 30,
      confidence: 'high',
      consensusLevel: 'strong_agree',
      category: 'sector',
      status: 'ACTIVE',
      nextBottleneck: '금리 인상 리스크',
      dissentReason: null,
    })
    expect(result[1]).toEqual({
      id: 2,
      agentPersona: 'tech-analyst',
      thesis: '반도체 과열 우려',
      timeframeDays: 14,
      confidence: 'medium',
      consensusLevel: 'divided',
      category: 'stock',
      status: 'CONFIRMED',
      nextBottleneck: null,
      dissentReason: '실적 지지',
    })
  })

  it('DB error 시 Error throw', async () => {
    const chainable = createMockChainable({
      error: { message: 'query failed' },
    })
    let orderCallCount = 0
    chainable.order = vi.fn().mockImplementation(() => {
      orderCallCount++
      if (orderCallCount >= 2) {
        return Promise.resolve({
          data: null,
          error: { message: 'query failed' },
        })
      }
      return chainable
    })

    const client = { from: vi.fn().mockReturnValue(chainable) }
    mockedCreateClient.mockResolvedValue(client as never)

    await expect(fetchThesesByDate('2026-03-09')).rejects.toThrow(
      'Thesis 조회 실패: query failed',
    )
  })

  it('data null이면 빈 배열', async () => {
    const chainable = createMockChainable({ data: null })
    let orderCallCount = 0
    chainable.order = vi.fn().mockImplementation(() => {
      orderCallCount++
      if (orderCallCount >= 2) {
        return Promise.resolve({ data: null, error: null })
      }
      return chainable
    })

    const client = { from: vi.fn().mockReturnValue(chainable) }
    mockedCreateClient.mockResolvedValue(client as never)

    const result = await fetchThesesByDate('2026-03-09')

    expect(result).toEqual([])
  })
})

describe('fetchRegimeByDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상 데이터 → MarketRegimeSummary 매핑', async () => {
    const mockData = {
      regime: 'MID_BULL',
      rationale: '주요 지수 상승 추세 유지',
      confidence: 'high',
    }

    setupMockClient({ data: mockData })

    const result = await fetchRegimeByDate('2026-03-09')

    expect(result).toEqual({
      regime: 'MID_BULL',
      rationale: '주요 지수 상승 추세 유지',
      confidence: 'high',
    })
  })

  it('PGRST116 에러 → null 반환', async () => {
    setupMockClient({
      error: { code: 'PGRST116', message: 'no rows returned' },
    })

    const result = await fetchRegimeByDate('2026-03-09')

    expect(result).toBeNull()
  })

  it('기타 에러 → Error throw', async () => {
    setupMockClient({
      error: { code: 'PGRST000', message: 'regime table error' },
    })

    await expect(fetchRegimeByDate('2026-03-09')).rejects.toThrow(
      '레짐 조회 실패: regime table error',
    )
  })

  it('data null이면 null 반환', async () => {
    setupMockClient({ data: null, error: null })

    const result = await fetchRegimeByDate('2026-03-09')

    expect(result).toBeNull()
  })
})
