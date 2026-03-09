import Link from 'next/link'
import { notFound } from 'next/navigation'

import { DebateDetailTabs } from '@/features/debates/components/DebateDetailTabs'
import {
  fetchDebateSessionByDate,
  fetchThesesByDate,
  fetchRegimeByDate,
} from '@/features/debates/lib/supabase-queries'
import { parseRoundOutputs } from '@/features/debates/lib/parse-round-outputs'

interface Props {
  params: Promise<{ date: string }>
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${year}년 ${Number(month)}월 ${Number(day)}일`
}

export default async function DebateDetailPage({ params }: Props) {
  const { date } = await params

  const [session, theses, regime] = await Promise.all([
    fetchDebateSessionByDate(date),
    fetchThesesByDate(date),
    fetchRegimeByDate(date),
  ])

  if (session == null) {
    notFound()
  }

  const round1Outputs = parseRoundOutputs(session.round1Outputs)
  const round2Outputs = parseRoundOutputs(session.round2Outputs)

  return (
    <main className="p-6">
      <div className="mb-6">
        <Link
          href="/debates"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; 토론 목록
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{formatDate(date)} 토론</h1>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
          {session.vix != null && (
            <span>VIX: {Number(session.vix).toFixed(1)}</span>
          )}
          {session.fearGreedScore != null && (
            <span>
              Fear &amp; Greed: {Number(session.fearGreedScore).toFixed(0)}
            </span>
          )}
          {session.phase2Ratio != null && (
            <span>
              Phase 2 비율: {Number(session.phase2Ratio).toFixed(1)}%
            </span>
          )}
          <span>Thesis: {session.thesesCount}건</span>
        </div>
      </div>

      <DebateDetailTabs
        round1Outputs={round1Outputs}
        round2Outputs={round2Outputs}
        synthesisReport={session.synthesisReport}
        theses={theses}
        regime={regime}
      />
    </main>
  )
}
