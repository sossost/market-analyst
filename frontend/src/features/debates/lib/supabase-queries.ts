import { createClient } from '@/features/auth/lib/supabase-server'

import type {
  DebateSessionSummary,
  DebateSessionDetail,
  DebateThesis,
  MarketRegimeSummary,
} from '../types'

const ITEMS_PER_PAGE = 20

interface FetchDebateSessionsResult {
  sessions: DebateSessionSummary[]
  total: number
}

export async function fetchDebateSessions(
  page: number,
): Promise<FetchDebateSessionsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * ITEMS_PER_PAGE

  const { data, error, count } = await supabase
    .from('debate_sessions')
    .select(
      'id, date, vix, fear_greed_score, phase2_ratio, top_sector_rs, theses_count',
      { count: 'exact' },
    )
    .order('date', { ascending: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1)

  if (error != null) {
    throw new Error(`토론 목록 조회 실패: ${error.message}`)
  }

  const sessions: DebateSessionSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    date: row.date,
    vix: row.vix,
    fearGreedScore: row.fear_greed_score,
    phase2Ratio: row.phase2_ratio,
    topSectorRs: row.top_sector_rs,
    thesesCount: row.theses_count,
  }))

  return { sessions, total: count ?? 0 }
}

export async function fetchDebateSessionByDate(
  date: string,
): Promise<DebateSessionDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('debate_sessions')
    .select(
      'id, date, vix, fear_greed_score, phase2_ratio, top_sector_rs, theses_count, round1_outputs, round2_outputs, synthesis_report, market_snapshot, tokens_input, tokens_output, duration_ms',
    )
    .eq('date', date)
    .limit(1)
    .single()

  if (error != null) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(`토론 상세 조회 실패: ${error.message}`)
  }

  if (data == null) {
    return null
  }

  return {
    id: data.id,
    date: data.date,
    vix: data.vix,
    fearGreedScore: data.fear_greed_score,
    phase2Ratio: data.phase2_ratio,
    topSectorRs: data.top_sector_rs,
    thesesCount: data.theses_count,
    round1Outputs: data.round1_outputs,
    round2Outputs: data.round2_outputs,
    synthesisReport: data.synthesis_report,
    marketSnapshot: data.market_snapshot,
    tokensInput: data.tokens_input,
    tokensOutput: data.tokens_output,
    durationMs: data.duration_ms,
  }
}

export async function fetchThesesByDate(
  date: string,
): Promise<DebateThesis[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('theses')
    .select(
      'id, agent_persona, thesis, timeframe_days, confidence, consensus_level, category, status, next_bottleneck, dissent_reason',
    )
    .eq('debate_date', date)
    .order('confidence', { ascending: false })
    .order('id', { ascending: true })

  if (error != null) {
    throw new Error(`Thesis 조회 실패: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    agentPersona: row.agent_persona,
    thesis: row.thesis,
    timeframeDays: row.timeframe_days,
    confidence: row.confidence as DebateThesis['confidence'],
    consensusLevel: row.consensus_level,
    category: row.category,
    status: row.status as DebateThesis['status'],
    nextBottleneck: row.next_bottleneck,
    dissentReason: row.dissent_reason,
  }))
}

export async function fetchRegimeByDate(
  date: string,
): Promise<MarketRegimeSummary | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('market_regimes')
    .select('regime, rationale, confidence')
    .eq('regime_date', date)
    .limit(1)
    .single()

  if (error != null) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(`레짐 조회 실패: ${error.message}`)
  }

  if (data == null) {
    return null
  }

  return {
    regime: data.regime as MarketRegimeSummary['regime'],
    rationale: data.rationale,
    confidence: data.confidence as MarketRegimeSummary['confidence'],
  }
}
