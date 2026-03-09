import Link from 'next/link'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { DebateSessionSummary } from '../types'

interface DebateListItemProps {
  session: DebateSessionSummary
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${year}년 ${Number(month)}월 ${Number(day)}일`
}

export function DebateListItem({ session }: DebateListItemProps) {
  return (
    <Link href={`/debates/${session.date}`} className="block">
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle>{formatDate(session.date)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricItem
              label="VIX"
              value={session.vix != null ? Number(session.vix).toFixed(1) : '-'}
            />
            <MetricItem
              label="Fear & Greed"
              value={
                session.fearGreedScore != null
                  ? Number(session.fearGreedScore).toFixed(0)
                  : '-'
              }
            />
            <MetricItem
              label="Phase 2 비율"
              value={
                session.phase2Ratio != null
                  ? `${Number(session.phase2Ratio).toFixed(1)}%`
                  : '-'
              }
            />
            <MetricItem
              label="Thesis"
              value={`${session.thesesCount}건`}
            />
          </div>
          {session.topSectorRs != null && (
            <p className="mt-3 truncate text-xs text-muted-foreground">
              {session.topSectorRs}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
