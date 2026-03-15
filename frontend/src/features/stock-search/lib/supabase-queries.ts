import { createClient } from '@/features/auth/lib/supabase-server'

import type {
  FundamentalData,
  FundamentalScore,
  IndustryContext,
  QuarterlyFinancial,
  RecommendationRecord,
  RecommendationStatus,
  SectorContext,
  SepaGrade,
  StockPhase,
  StockProfile,
  StockSearchResult,
} from '../types'

const VALID_SEPA_GRADES = new Set<string>(['S', 'A', 'B', 'C', 'F'])
const VALID_PHASES = new Set<number>([1, 2, 3, 4])
const RECOMMENDATION_HISTORY_LIMIT = 10
const QUARTERLY_FINANCIALS_LIMIT = 4

function isSepaGrade(value: unknown): value is SepaGrade {
  return typeof value === 'string' && VALID_SEPA_GRADES.has(value)
}

function isStockPhase(value: unknown): value is StockPhase {
  return typeof value === 'number' && VALID_PHASES.has(value)
}

function isRecommendationStatus(value: unknown): value is RecommendationStatus {
  return value === 'active' || value === 'closed'
}

/** 쿼리 1: 자동완성 검색 (Route Handler용 — browser client 필요) */
export async function searchStockSymbols(
  query: string,
): Promise<StockSearchResult[]> {
  const { createClient: createBrowserClient } = await import(
    '@/features/auth/lib/supabase-browser'
  )
  const supabase = createBrowserClient()

  const { data, error } = await supabase
    .from('symbols')
    .select('symbol, company_name, sector')
    .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
    .eq('is_etf', false)
    .eq('is_fund', false)
    .order('market_cap', { ascending: false })
    .limit(10)

  if (error != null) {
    throw new Error(`종목 검색 실패: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    symbol: row.symbol,
    companyName: row.company_name ?? '',
    sector: row.sector ?? null,
  }))
}

/** 쿼리 1 (서버 측): Route Handler에서 server client로 자동완성 검색 */
export async function searchStockSymbolsServer(
  query: string,
): Promise<StockSearchResult[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('symbols')
    .select('symbol, company_name, sector')
    .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
    .eq('is_etf', false)
    .eq('is_fund', false)
    .order('market_cap', { ascending: false })
    .limit(10)

  if (error != null) {
    throw new Error(`종목 검색 실패: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    symbol: row.symbol,
    companyName: row.company_name ?? '',
    sector: row.sector ?? null,
  }))
}

/** 쿼리 2: 종목 기본 + 기술적 정보 */
export async function fetchStockProfile(
  symbol: string,
): Promise<StockProfile | null> {
  const supabase = await createClient()

  const { data: symbolData, error: symbolError } = await supabase
    .from('symbols')
    .select('symbol, company_name, sector, industry, market_cap')
    .eq('symbol', symbol)
    .single()

  if (symbolError != null) {
    if (symbolError.code === 'PGRST116') {
      return null
    }
    throw new Error(`종목 기본 정보 조회 실패: ${symbolError.message}`)
  }

  if (symbolData == null) {
    return null
  }

  const [phaseResult, priceResult] = await Promise.all([
    supabase
      .from('stock_phases')
      .select('phase, ma150_slope, rs_score, pct_from_high_52w, pct_from_low_52w, date')
      .eq('symbol', symbol)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('daily_prices')
      .select('close, date')
      .eq('symbol', symbol)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (phaseResult.error != null) {
    throw new Error(`Phase 정보 조회 실패: ${phaseResult.error.message}`)
  }
  if (priceResult.error != null) {
    throw new Error(`가격 정보 조회 실패: ${priceResult.error.message}`)
  }

  const phaseData = phaseResult.data
  const priceData = priceResult.data

  let ma20: number | null = null
  let ma50: number | null = null
  let ma100: number | null = null
  let ma200: number | null = null

  if (priceData != null) {
    const { data: maData, error: maError } = await supabase
      .from('daily_ma')
      .select('ma20, ma50, ma100, ma200')
      .eq('symbol', symbol)
      .eq('date', priceData.date)
      .maybeSingle()

    if (maError != null) {
      throw new Error(`MA 정보 조회 실패: ${maError.message}`)
    }

    if (maData != null) {
      ma20 = maData.ma20 ?? null
      ma50 = maData.ma50 ?? null
      ma100 = maData.ma100 ?? null
      ma200 = maData.ma200 ?? null
    }
  }

  const rawPhase = phaseData?.phase
  const phase = isStockPhase(rawPhase) ? rawPhase : null

  return {
    symbol: symbolData.symbol,
    companyName: symbolData.company_name ?? '',
    sector: symbolData.sector ?? '',
    industry: symbolData.industry ?? '',
    marketCap: symbolData.market_cap ?? null,
    phase,
    ma150Slope: phaseData?.ma150_slope ?? null,
    rsScore: phaseData?.rs_score ?? null,
    pctFromHigh52w: phaseData?.pct_from_high_52w ?? null,
    pctFromLow52w: phaseData?.pct_from_low_52w ?? null,
    close: priceData?.close ?? null,
    priceDate: priceData?.date ?? null,
    ma20,
    ma50,
    ma100,
    ma200,
  }
}

/** 쿼리 3: 섹터 맥락 + 쿼리 4: 섹터 내 순위 */
export async function fetchSectorContext(
  sector: string,
  rsScore: number | null,
): Promise<SectorContext> {
  const supabase = await createClient()

  const [sectorResult, rankResult] = await Promise.all([
    supabase
      .from('sector_rs_daily')
      .select('avg_rs, rs_rank, group_phase, phase2_ratio, change_4w, change_8w, change_12w, stock_count')
      .eq('sector', sector)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    rsScore != null
      ? supabase.rpc('get_sector_stock_rank', {
          p_sector: sector,
          p_rs_score: rsScore,
        })
      : Promise.resolve({ data: null, error: null }),
  ])

  if (sectorResult.error != null) {
    throw new Error(`섹터 맥락 조회 실패: ${sectorResult.error.message}`)
  }

  const sectorData = sectorResult.data
  const rawPhase = sectorData?.group_phase
  const groupPhase = isStockPhase(rawPhase) ? rawPhase : null

  // RPC가 없으면 직접 집계 쿼리
  let stockRsRank: number | null = null
  let stockTotalInSector: number | null = null

  if (rsScore != null) {
    const { data: allStocks, error: allError } = await supabase
      .from('stock_phases')
      .select('symbol, rs_score, symbols!inner(sector)')
      .eq('symbols.sector', sector)
      .order('date', { ascending: false })

    if (allError == null && allStocks != null) {
      // 최신 date 기준으로 필터링
      const latestDate = allStocks[0]
        ? (allStocks[0] as Record<string, unknown>).date as string | undefined
        : undefined

      const latestStocks = latestDate != null
        ? allStocks.filter((s) => (s as Record<string, unknown>).date === latestDate)
        : allStocks

      stockTotalInSector = latestStocks.length
      stockRsRank =
        latestStocks.filter(
          (s) => (s.rs_score ?? 0) >= rsScore,
        ).length
    }
  }

  return {
    avgRs: sectorData?.avg_rs ?? null,
    rsRank: sectorData?.rs_rank ?? null,
    groupPhase,
    phase2Ratio: sectorData?.phase2_ratio ?? null,
    change4w: sectorData?.change_4w ?? null,
    change8w: sectorData?.change_8w ?? null,
    change12w: sectorData?.change_12w ?? null,
    stockCount: sectorData?.stock_count ?? null,
    stockRsRank,
    stockTotalInSector,
  }
}

/** 쿼리 3 (산업): 산업 맥락 + 산업 내 순위 */
export async function fetchIndustryContext(
  industry: string,
  rsScore: number | null,
): Promise<IndustryContext> {
  const supabase = await createClient()

  const { data: industryData, error: industryError } = await supabase
    .from('industry_rs_daily')
    .select('avg_rs, rs_rank, group_phase, phase2_ratio, change_4w, change_8w')
    .eq('industry', industry)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (industryError != null) {
    throw new Error(`산업 맥락 조회 실패: ${industryError.message}`)
  }

  const rawPhase = industryData?.group_phase
  const groupPhase = isStockPhase(rawPhase) ? rawPhase : null

  let stockRsRank: number | null = null
  let stockTotalInIndustry: number | null = null

  if (rsScore != null) {
    const { data: allStocks, error: allError } = await supabase
      .from('stock_phases')
      .select('symbol, rs_score, date, symbols!inner(industry)')
      .eq('symbols.industry', industry)
      .order('date', { ascending: false })

    if (allError == null && allStocks != null && allStocks.length > 0) {
      const latestDate = (allStocks[0] as Record<string, unknown>).date as string | undefined

      const latestStocks = latestDate != null
        ? allStocks.filter((s) => (s as Record<string, unknown>).date === latestDate)
        : allStocks

      stockTotalInIndustry = latestStocks.length
      stockRsRank = latestStocks.filter(
        (s) => (s.rs_score ?? 0) >= rsScore,
      ).length
    }
  }

  return {
    avgRs: industryData?.avg_rs ?? null,
    rsRank: industryData?.rs_rank ?? null,
    groupPhase,
    phase2Ratio: industryData?.phase2_ratio ?? null,
    change4w: industryData?.change_4w ?? null,
    change8w: industryData?.change_8w ?? null,
    stockRsRank,
    stockTotalInIndustry,
  }
}

/** 쿼리 5: 펀더멘탈 (SEPA 등급 + 최근 4분기 EPS/매출) */
export async function fetchFundamentalData(
  symbol: string,
): Promise<FundamentalData> {
  const supabase = await createClient()

  const [scoreResult, financialsResult] = await Promise.all([
    supabase
      .from('fundamental_scores')
      .select('grade, total_score, scored_date, criteria')
      .eq('symbol', symbol)
      .order('scored_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('quarterly_financials')
      .select('period_end_date, eps_diluted, revenue')
      .eq('symbol', symbol)
      .order('period_end_date', { ascending: false })
      .limit(QUARTERLY_FINANCIALS_LIMIT),
  ])

  if (scoreResult.error != null) {
    throw new Error(`SEPA 등급 조회 실패: ${scoreResult.error.message}`)
  }
  if (financialsResult.error != null) {
    throw new Error(`분기 재무 조회 실패: ${financialsResult.error.message}`)
  }

  const rawGrade = scoreResult.data?.grade
  const grade = isSepaGrade(rawGrade) ? rawGrade : null

  const score: FundamentalScore | null =
    scoreResult.data != null
      ? {
          grade,
          totalScore: scoreResult.data.total_score ?? null,
          scoredDate: scoreResult.data.scored_date ?? null,
          criteria:
            (scoreResult.data.criteria as Record<string, unknown>) ?? null,
        }
      : null

  const quarterlyFinancials: QuarterlyFinancial[] = (
    financialsResult.data ?? []
  ).map((row) => ({
    periodEndDate: row.period_end_date,
    epsDiluted: row.eps_diluted ?? null,
    revenue: row.revenue ?? null,
  }))

  return { score, quarterlyFinancials }
}

/** 쿼리 6: 추천 이력 */
export async function fetchRecommendationHistory(
  symbol: string,
): Promise<RecommendationRecord[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('recommendations')
    .select(
      'recommendation_date, entry_price, current_price, pnl_percent, max_pnl_percent, status, close_date, close_reason, entry_phase',
    )
    .eq('symbol', symbol)
    .order('recommendation_date', { ascending: false })
    .limit(RECOMMENDATION_HISTORY_LIMIT)

  if (error != null) {
    throw new Error(`추천 이력 조회 실패: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    recommendationDate: row.recommendation_date,
    entryPrice: row.entry_price ?? null,
    currentPrice: row.current_price ?? null,
    pnlPercent: row.pnl_percent ?? null,
    maxPnlPercent: row.max_pnl_percent ?? null,
    status: isRecommendationStatus(row.status) ? row.status : 'active',
    closeDate: row.close_date ?? null,
    closeReason: row.close_reason ?? null,
    entryPhase: row.entry_phase ?? null,
  }))
}
