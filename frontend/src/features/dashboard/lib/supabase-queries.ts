import { createClient } from '@/features/auth/lib/supabase-server'

import type {
  DashboardReport,
  ActiveThesis,
  RecommendationSummary,
  RecommendationStats,
  RecentRegime,
} from '../types'

const CONFIDENCE_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export const THESES_QUERY_LIMIT = 10
const RECOMMENDATIONS_QUERY_LIMIT = 100
const REGIMES_QUERY_LIMIT = 7
const TOP_ITEMS_LIMIT = 5

export async function fetchLatestDailyReport(): Promise<DashboardReport | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('daily_reports')
    .select('id, report_date, reported_symbols, market_summary')
    .eq('type', 'daily')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error != null) {
    throw new Error(`최신 리포트 조회 실패: ${error.message}`)
  }

  if (data == null) {
    return null
  }

  const marketSummary = data.market_summary as Record<string, unknown> | null

  return {
    id: data.id,
    reportDate: data.report_date,
    phase2Ratio: (marketSummary?.phase2Ratio as number) ?? 0,
    leadingSectors: (marketSummary?.leadingSectors as string[]) ?? [],
    totalAnalyzed: (marketSummary?.totalAnalyzed as number) ?? 0,
    symbolCount: Array.isArray(data.reported_symbols)
      ? data.reported_symbols.length
      : 0,
  }
}

export async function fetchActiveTheses(): Promise<{
  items: ActiveThesis[]
  totalCount: number
}> {
  const supabase = await createClient()

  const { data, error, count } = await supabase
    .from('theses')
    .select(
      'id, agent_persona, thesis, timeframe_days, confidence, consensus_level, category, status, next_bottleneck, dissent_reason',
      { count: 'exact' },
    )
    .eq('status', 'ACTIVE')
    .order('id', { ascending: false })
    .range(0, THESES_QUERY_LIMIT - 1)

  if (error != null) {
    throw new Error(`Active thesis 조회 실패: ${error.message}`)
  }

  const items = (data ?? [])
    .map((row) => ({
      id: row.id,
      agentPersona: row.agent_persona,
      thesis: row.thesis,
      timeframeDays: row.timeframe_days,
      confidence: row.confidence as ActiveThesis['confidence'],
      consensusLevel: row.consensus_level,
      category: row.category,
      status: row.status as ActiveThesis['status'],
      nextBottleneck: row.next_bottleneck,
      dissentReason: row.dissent_reason,
    }))
    .sort(
      (a, b) =>
        (CONFIDENCE_ORDER[a.confidence] ?? 99) -
        (CONFIDENCE_ORDER[b.confidence] ?? 99),
    )

  return { items, totalCount: count ?? items.length }
}

export async function fetchActiveRecommendations(): Promise<RecommendationSummary[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('recommendations')
    .select(
      'id, symbol, sector, pnl_percent, max_pnl_percent, days_held, current_phase, recommendation_date',
    )
    .eq('status', 'ACTIVE')
    .order('pnl_percent', { ascending: false })
    .range(0, RECOMMENDATIONS_QUERY_LIMIT - 1)

  if (error != null) {
    throw new Error(`활성 추천 종목 조회 실패: ${error.message}`)
  }

  type RowWithDate = { summary: RecommendationSummary; recommendationDate: string }
  const dedupedBySymbol = new Map<string, RowWithDate>()

  for (const row of data ?? []) {
    const existing = dedupedBySymbol.get(row.symbol)
    const shouldReplace =
      existing == null ||
      (row.recommendation_date != null &&
        row.recommendation_date > (existing.recommendationDate ?? ''))

    if (shouldReplace) {
      dedupedBySymbol.set(row.symbol, {
        summary: {
          id: row.id,
          symbol: row.symbol,
          sector: row.sector,
          pnlPercent: row.pnl_percent != null ? Number(row.pnl_percent) : null,
          maxPnlPercent:
            row.max_pnl_percent != null ? Number(row.max_pnl_percent) : null,
          daysHeld: row.days_held ?? 0,
          currentPhase: row.current_phase,
        },
        recommendationDate: row.recommendation_date,
      })
    }
  }

  return Array.from(dedupedBySymbol.values()).map(({ summary }) => summary)
}

export function calculateRecommendationStats(
  items: RecommendationSummary[],
): RecommendationStats {
  const activeCount = items.length

  if (activeCount === 0) {
    return {
      activeCount: 0,
      winRate: 0,
      avgPnlPercent: 0,
      avgDaysHeld: 0,
      topItems: [],
    }
  }

  const itemsWithPnl = items.filter(
    (item): item is RecommendationSummary & { pnlPercent: number } =>
      item.pnlPercent != null,
  )
  const winCount = itemsWithPnl.filter((item) => item.pnlPercent > 0).length

  const winRate =
    itemsWithPnl.length > 0 ? (winCount / itemsWithPnl.length) * 100 : 0

  const avgPnlPercent =
    itemsWithPnl.length > 0
      ? itemsWithPnl.reduce((sum, item) => sum + item.pnlPercent, 0) /
        itemsWithPnl.length
      : 0

  const avgDaysHeld =
    activeCount > 0
      ? items.reduce((sum, item) => sum + item.daysHeld, 0) / activeCount
      : 0

  const topItems = [...items]
    .sort((a, b) => (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0))
    .slice(0, TOP_ITEMS_LIMIT)

  return {
    activeCount,
    winRate,
    avgPnlPercent,
    avgDaysHeld,
    topItems,
  }
}

export async function fetchRecentRegimes(): Promise<RecentRegime[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('market_regimes')
    .select('regime_date, regime, rationale, confidence')
    .order('regime_date', { ascending: false })
    .range(0, REGIMES_QUERY_LIMIT - 1)

  if (error != null) {
    throw new Error(`최근 레짐 조회 실패: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    regimeDate: row.regime_date,
    regime: row.regime as RecentRegime['regime'],
    rationale: row.rationale,
    confidence: row.confidence as RecentRegime['confidence'],
  }))
}
