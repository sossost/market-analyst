import { createClient } from '@/features/auth/lib/supabase-server'

import { ITEMS_PER_PAGE, isRecommendationStatus } from '../constants'
import type {
  RecommendationDetail,
  RecommendationStatus,
  RecommendationSummary,
} from '../types'

// ETL이 새 상태를 추가할 경우 RecommendationStatus 타입을 먼저 확장해야 함. 임시 폴백으로 ACTIVE 사용.
const FALLBACK_STATUS: RecommendationStatus = 'ACTIVE'

interface FetchRecommendationsResult {
  recommendations: RecommendationSummary[]
  total: number
}

export async function fetchRecommendations(
  page: number,
  status?: RecommendationStatus,
): Promise<FetchRecommendationsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * ITEMS_PER_PAGE

  let query = supabase
    .from('recommendations')
    .select(
      'id, symbol, recommendation_date, entry_price, entry_phase, entry_prev_phase, entry_rs_score, current_price, current_phase, pnl_percent, max_pnl_percent, days_held, status, close_date, sector, market_regime',
      { count: 'exact' },
    )
    .order('recommendation_date', { ascending: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1)

  if (status != null) {
    // "종료" 필터는 CLOSED + CLOSED_PHASE_EXIT 모두 포함
    if (status === 'CLOSED') {
      query = query.in('status', ['CLOSED', 'CLOSED_PHASE_EXIT'])
    } else {
      query = query.eq('status', status)
    }
  }

  const { data, error, count } = await query

  if (error != null) {
    throw new Error(`추천 종목 목록 조회 실패: ${error.message}`)
  }

  const recommendations: RecommendationSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    symbol: row.symbol,
    recommendationDate: row.recommendation_date,
    entryPrice: Number(row.entry_price),
    entryPhase: row.entry_phase,
    entryPrevPhase: row.entry_prev_phase ?? null,
    entryRsScore: row.entry_rs_score ?? null,
    currentPrice: row.current_price != null ? Number(row.current_price) : null,
    currentPhase: row.current_phase ?? null,
    pnlPercent: row.pnl_percent != null ? Number(row.pnl_percent) : null,
    maxPnlPercent:
      row.max_pnl_percent != null ? Number(row.max_pnl_percent) : null,
    daysHeld: row.days_held ?? 0,
    status: isRecommendationStatus(row.status) ? row.status : FALLBACK_STATUS,
    closeDate: row.close_date ?? null,
    sector: row.sector ?? null,
    marketRegime: row.market_regime ?? null,
  }))

  return { recommendations, total: count ?? 0 }
}

export async function fetchRecommendationById(
  id: number,
): Promise<RecommendationDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('recommendations')
    .select('*')
    .eq('id', id)
    .single()

  if (error != null) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(`추천 종목 상세 조회 실패: ${error.message}`)
  }

  return {
    id: data.id,
    symbol: data.symbol,
    recommendationDate: data.recommendation_date,
    entryPrice: Number(data.entry_price),
    entryPhase: data.entry_phase,
    entryPrevPhase: data.entry_prev_phase ?? null,
    entryRsScore: data.entry_rs_score ?? null,
    currentPrice: data.current_price != null ? Number(data.current_price) : null,
    currentPhase: data.current_phase ?? null,
    currentRsScore: data.current_rs_score ?? null,
    pnlPercent: data.pnl_percent != null ? Number(data.pnl_percent) : null,
    maxPnlPercent:
      data.max_pnl_percent != null ? Number(data.max_pnl_percent) : null,
    daysHeld: data.days_held ?? 0,
    status: isRecommendationStatus(data.status) ? data.status : FALLBACK_STATUS,
    closeDate: data.close_date ?? null,
    closePrice: data.close_price != null ? Number(data.close_price) : null,
    closeReason: data.close_reason ?? null,
    sector: data.sector ?? null,
    industry: data.industry ?? null,
    marketRegime: data.market_regime ?? null,
    lastUpdated: data.last_updated ?? null,
    reason: data.reason ?? null,
  }
}
