import Link from 'next/link'

import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { ThesisBadge } from '@/features/debates/components/ThesisBadge'
import { getPersonaLabel } from '@/features/debates/constants'

import type { ActiveThesis, ThesisStats } from '../types'
import { THESES_QUERY_LIMIT, fetchActiveTheses, fetchThesisStats } from '../lib/supabase-queries'

export async function ActiveThesesCard() {
  const [{ items: theses, totalCount }, thesisStats] = await Promise.all([
    fetchActiveTheses(),
    fetchThesisStats(),
  ])
  const hasMore = totalCount > THESES_QUERY_LIMIT

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Active Thesis</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <ThesisHitSummary stats={thesisStats} />
        {theses.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            활성 thesis가 없습니다
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {theses.map((thesis) => (
              <ThesisItem key={thesis.id} thesis={thesis} />
            ))}
            {hasMore && (
              <p className="text-center text-xs text-muted-foreground">
                외 {totalCount - THESES_QUERY_LIMIT}건 더 있음
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Link
          href="/debates"
          className="text-sm text-primary hover:underline"
        >
          전체 보기 →
        </Link>
      </CardFooter>
    </Card>
  )
}

function ThesisHitSummary({ stats }: { stats: ThesisStats }) {
  const resolved = stats.confirmedCount + stats.invalidatedCount

  if (resolved === 0) {
    return null
  }

  const hitRate = (stats.confirmedCount / resolved) * 100

  return (
    <div className="mb-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span>
        적중 {stats.confirmedCount} / 무효 {stats.invalidatedCount}
      </span>
      <span className="ml-2 font-medium">&mdash; {hitRate.toFixed(1)}%</span>
    </div>
  )
}

function ThesisItem({ thesis }: { thesis: ActiveThesis }) {
  const personaLabel = getPersonaLabel(thesis.agentPersona)

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ThesisBadge status={thesis.status} />
        <Badge variant="outline">{personaLabel}</Badge>
        <Badge variant="secondary">{thesis.confidence}</Badge>
      </div>
      <p className="text-sm leading-relaxed">{thesis.thesis}</p>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>기간: {thesis.timeframeDays}일</span>
        <span>합의: {thesis.consensusLevel}</span>
        {thesis.category != null && thesis.category !== '' && (
          <span>{thesis.category}</span>
        )}
      </div>
    </div>
  )
}
