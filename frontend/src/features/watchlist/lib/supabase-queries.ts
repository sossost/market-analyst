import { createClient } from '@/features/auth/lib/supabase-server'

import { ITEMS_PER_PAGE, isWatchlistStatus } from '../constants'
import type {
  PhaseTrajectoryPoint,
  WatchlistStatus,
  WatchlistStockDetail,
  WatchlistStockSummary,
} from '../types'

const FALLBACK_STATUS: WatchlistStatus = 'ACTIVE'

interface FetchWatchlistStocksResult {
  stocks: WatchlistStockSummary[]
  total: number
}

export async function fetchWatchlistStocks(
  page: number,
  status?: WatchlistStatus,
): Promise<FetchWatchlistStocksResult> {
  const supabase = await createClient()
  const offset = (page - 1) * ITEMS_PER_PAGE

  let query = supabase
    .from('watchlist_stocks')
    .select(
      'id, symbol, status, entry_date, entry_phase, entry_sector, entry_sepa_grade, current_phase, sector_relative_perf, pnl_percent, days_tracked',
      { count: 'exact' },
    )
    .order('entry_date', { ascending: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1)

  if (status != null) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error != null) {
    throw new Error(`관심종목 목록 조회 실패: ${error.message}`)
  }

  const stocks: WatchlistStockSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    symbol: row.symbol,
    status: isWatchlistStatus(row.status) ? row.status : FALLBACK_STATUS,
    entryDate: row.entry_date,
    entryPhase: row.entry_phase,
    entrySector: row.entry_sector ?? null,
    entrySepaGrade: row.entry_sepa_grade ?? null,
    currentPhase: row.current_phase ?? null,
    sectorRelativePerf:
      row.sector_relative_perf != null
        ? Number(row.sector_relative_perf)
        : null,
    pnlPercent: row.pnl_percent != null ? Number(row.pnl_percent) : null,
    daysTracked: row.days_tracked ?? 0,
  }))

  return { stocks, total: count ?? 0 }
}

export async function fetchWatchlistStockById(
  id: number,
): Promise<WatchlistStockDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('watchlist_stocks')
    .select('*')
    .eq('id', id)
    .single()

  if (error != null) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(`관심종목 상세 조회 실패: ${error.message}`)
  }

  return {
    id: data.id,
    symbol: data.symbol,
    status: isWatchlistStatus(data.status) ? data.status : FALLBACK_STATUS,
    entryDate: data.entry_date,
    exitDate: data.exit_date ?? null,
    exitReason: data.exit_reason ?? null,
    entryPhase: data.entry_phase,
    entryRsScore: data.entry_rs_score ?? null,
    entrySectorRs:
      data.entry_sector_rs != null ? Number(data.entry_sector_rs) : null,
    entrySepaGrade: data.entry_sepa_grade ?? null,
    entryThesisId: data.entry_thesis_id ?? null,
    entrySector: data.entry_sector ?? null,
    entryIndustry: data.entry_industry ?? null,
    entryReason: data.entry_reason ?? null,
    trackingEndDate: data.tracking_end_date ?? null,
    currentPhase: data.current_phase ?? null,
    currentRsScore: data.current_rs_score ?? null,
    phaseTrajectory: parsePhaseTrajectory(data.phase_trajectory),
    sectorRelativePerf:
      data.sector_relative_perf != null
        ? Number(data.sector_relative_perf)
        : null,
    priceAtEntry:
      data.price_at_entry != null ? Number(data.price_at_entry) : null,
    currentPrice:
      data.current_price != null ? Number(data.current_price) : null,
    pnlPercent: data.pnl_percent != null ? Number(data.pnl_percent) : null,
    maxPnlPercent:
      data.max_pnl_percent != null ? Number(data.max_pnl_percent) : null,
    daysTracked: data.days_tracked ?? 0,
    lastUpdated: data.last_updated ?? null,
  }
}

function parsePhaseTrajectory(
  raw: unknown,
): PhaseTrajectoryPoint[] | null {
  if (!Array.isArray(raw)) {
    return null
  }
  return raw
    .filter(
      (item): item is { date: string; phase: number; rsScore: number | null } =>
        typeof item === 'object' &&
        item != null &&
        typeof item.date === 'string' &&
        typeof item.phase === 'number',
    )
    .map((item) => ({
      date: item.date,
      phase: item.phase,
      rsScore: item.rsScore ?? null,
    }))
}
