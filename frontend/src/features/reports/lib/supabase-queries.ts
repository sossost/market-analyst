import { createClient } from '@/features/auth/lib/supabase-server'

import type { ReportSummary, ReportDetail, ReportType } from '../types'

const ITEMS_PER_PAGE = 20

interface FetchReportsResult {
  reports: ReportSummary[]
  total: number
}

export async function fetchReports(
  page: number,
): Promise<FetchReportsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * ITEMS_PER_PAGE

  const { data, error, count } = await supabase
    .from('daily_reports')
    .select('id, report_date, type, reported_symbols, market_summary', {
      count: 'exact',
    })
    .order('report_date', { ascending: false })
    .range(offset, offset + ITEMS_PER_PAGE - 1)

  if (error != null) {
    throw new Error(`리포트 목록 조회 실패: ${error.message}`)
  }

  const reports: ReportSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    reportDate: row.report_date,
    type: row.type as ReportType,
    symbolCount: Array.isArray(row.reported_symbols)
      ? row.reported_symbols.length
      : 0,
    leadingSectors: (row.market_summary as Record<string, unknown>)
      ?.leadingSectors as string[] ?? [],
    phase2Ratio: ((row.market_summary as Record<string, unknown>)
      ?.phase2Ratio as number) ?? 0,
  }))

  return { reports, total: count ?? 0 }
}

export async function fetchReportByDate(
  date: string,
): Promise<ReportDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('daily_reports')
    .select(
      'id, report_date, type, reported_symbols, market_summary, full_content, metadata',
    )
    .eq('report_date', date)
    .limit(1)
    .single()

  if (error != null) {
    if (error.code === 'PGRST116') {
      return null
    }
    throw new Error(`리포트 상세 조회 실패: ${error.message}`)
  }

  if (data == null) {
    return null
  }

  const marketSummary = data.market_summary as Record<string, unknown> | null
  const rawMetadata = data.metadata as Record<string, unknown> | null

  return {
    id: data.id,
    reportDate: data.report_date,
    type: data.type as ReportType,
    reportedSymbols: Array.isArray(data.reported_symbols)
      ? data.reported_symbols
      : [],
    marketSummary: {
      phase2Ratio: (marketSummary?.phase2Ratio as number) ?? 0,
      leadingSectors: (marketSummary?.leadingSectors as string[]) ?? [],
      totalAnalyzed: (marketSummary?.totalAnalyzed as number) ?? 0,
    },
    fullContent: data.full_content ?? null,
    metadata: {
      model: (rawMetadata?.model as string) ?? '',
      tokensUsed: (rawMetadata?.tokensUsed as {
        input: number
        output: number
      }) ?? { input: 0, output: 0 },
      toolCalls: (rawMetadata?.toolCalls as number) ?? 0,
      executionTime: (rawMetadata?.executionTime as number) ?? 0,
    },
  }
}
