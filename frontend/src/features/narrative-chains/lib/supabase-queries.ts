import { createClient } from '@/features/auth/lib/supabase-server'

import { ITEMS_PER_PAGE, isNarrativeChainStatus } from '../constants'
import type {
  NarrativeChainDetail,
  NarrativeChainStatus,
  NarrativeChainSummary,
} from '../types'

const FALLBACK_STATUS: NarrativeChainStatus = 'ACTIVE'

interface FetchNarrativeChainsResult {
  chains: NarrativeChainSummary[]
  total: number
}

export async function fetchNarrativeChains(
  page: number,
  status?: NarrativeChainStatus,
): Promise<FetchNarrativeChainsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * ITEMS_PER_PAGE

  let query = supabase
    .from('narrative_chains')
    .select(
      'id, megatrend, demand_driver, supply_chain, bottleneck, bottleneck_identified_at, next_bottleneck, status, beneficiary_sectors, beneficiary_tickers, linked_thesis_ids, alpha_compatible',
      { count: 'exact' },
    )
    .order('bottleneck_identified_at', { ascending: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1)

  if (status != null) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error != null) {
    throw new Error(`서사 체인 목록 조회 실패: ${error.message}`)
  }

  const chains: NarrativeChainSummary[] = (data ?? []).map(mapRowToChainSummary)

  return { chains, total: count ?? 0 }
}

export async function fetchNarrativeChainById(
  id: number,
): Promise<NarrativeChainDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('narrative_chains')
    .select('*')
    .eq('id', id)
    .single()

  if (error != null) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(`서사 체인 상세 조회 실패: ${error.message}`)
  }

  return mapRowToChainDetail(data)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapRowToChainSummary(row: any): NarrativeChainSummary {
  return {
    id: row.id,
    megatrend: row.megatrend,
    demandDriver: row.demand_driver,
    supplyChain: row.supply_chain,
    bottleneck: row.bottleneck,
    bottleneckIdentifiedAt: row.bottleneck_identified_at,
    nextBottleneck: row.next_bottleneck ?? null,
    status: isNarrativeChainStatus(row.status) ? row.status : FALLBACK_STATUS,
    beneficiarySectors: Array.isArray(row.beneficiary_sectors)
      ? row.beneficiary_sectors
      : [],
    beneficiaryTickers: Array.isArray(row.beneficiary_tickers)
      ? row.beneficiary_tickers
      : [],
    linkedThesisCount: Array.isArray(row.linked_thesis_ids)
      ? row.linked_thesis_ids.length
      : 0,
    alphaCompatible: row.alpha_compatible ?? null,
  }
}

export function mapRowToChainDetail(row: any): NarrativeChainDetail {
  return {
    ...mapRowToChainSummary(row),
    bottleneckResolvedAt: row.bottleneck_resolved_at ?? null,
    linkedThesisIds: Array.isArray(row.linked_thesis_ids)
      ? row.linked_thesis_ids
      : [],
    resolutionDays: row.resolution_days ?? null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
