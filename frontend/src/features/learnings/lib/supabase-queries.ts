import { createClient } from '@/features/auth/lib/supabase-server'

import { ITEMS_PER_PAGE, isLearningCategory, isVerificationPath } from '../constants'
import type { ActiveFilter } from '../constants'
import type { AgentLearning, LearningSummary } from '../types'

interface FetchLearningsResult {
  learnings: AgentLearning[]
  total: number
}

export async function fetchLearnings(
  page: number,
  activeFilter: ActiveFilter = 'active',
  categoryFilter?: 'confirmed' | 'caution',
): Promise<FetchLearningsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * ITEMS_PER_PAGE

  let query = supabase
    .from('agent_learnings')
    .select(
      'id, principle, category, hit_count, miss_count, hit_rate, is_active, verification_path, first_confirmed, last_verified, expires_at, created_at',
      { count: 'exact' },
    )
    .order('hit_rate', { ascending: false, nullsFirst: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1)

  if (activeFilter === 'active') {
    query = query.eq('is_active', true)
  } else if (activeFilter === 'inactive') {
    query = query.eq('is_active', false)
  }

  if (categoryFilter != null) {
    query = query.eq('category', categoryFilter)
  }

  const { data, error, count } = await query

  if (error != null) {
    throw new Error(`학습 원칙 목록 조회 실패: ${error.message}`)
  }

  const learnings: AgentLearning[] = (data ?? []).map((row) => mapRowToLearning(row))

  return { learnings, total: count ?? 0 }
}

export async function fetchLearningSummary(): Promise<LearningSummary> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agent_learnings')
    .select('hit_rate, last_verified')
    .eq('is_active', true)

  if (error != null) {
    throw new Error(`학습 요약 통계 조회 실패: ${error.message}`)
  }

  const rows = data ?? []
  const activePrincipleCount = rows.length

  const hitRates = rows
    .map((row) => (row.hit_rate != null ? Number(row.hit_rate) : null))
    .filter((rate): rate is number => rate != null)

  const averageHitRate =
    hitRates.length > 0
      ? hitRates.reduce((sum, rate) => sum + rate, 0) / hitRates.length
      : null

  const lastVerifiedDate = rows
    .map((row) => row.last_verified)
    .filter((date): date is string => date != null)
    .sort()
    .at(-1) ?? null

  return { activePrincipleCount, averageHitRate, lastVerifiedDate }
}

export function mapRowToLearning(row: Record<string, unknown>): AgentLearning {
  const rawCategory = row.category
  const rawPath = row.verification_path

  return {
    id: row.id as number,
    principle: row.principle as string,
    category: isLearningCategory(rawCategory) ? rawCategory : 'confirmed',
    hitCount: (row.hit_count as number) ?? 0,
    missCount: (row.miss_count as number) ?? 0,
    hitRate: row.hit_rate != null ? Number(row.hit_rate) : null,
    isActive: (row.is_active as boolean) ?? true,
    verificationPath: isVerificationPath(rawPath) ? rawPath : null,
    firstConfirmed: (row.first_confirmed as string) ?? null,
    lastVerified: (row.last_verified as string) ?? null,
    expiresAt: (row.expires_at as string) ?? null,
    createdAt: row.created_at as string,
  }
}
