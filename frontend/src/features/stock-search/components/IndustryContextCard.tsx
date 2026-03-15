import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { IndustryContext } from '../types'
import { PhaseBadge } from './PhaseBadge'

function formatRs(value: number | null): string {
  if (value == null) {
    return '-'
  }
  return value.toFixed(1)
}

function formatPct(value: number | null): string {
  if (value == null) {
    return '-'
  }
  return `${value.toFixed(1)}%`
}

function formatChangeArrow(change: number | null): React.ReactNode {
  if (change == null) {
    return <span className="text-muted-foreground">-</span>
  }
  const isPositive = change >= 0
  const arrow = isPositive ? '▲' : '▼'
  const cls = isPositive
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400'
  return (
    <span className={`text-xs font-semibold ${cls}`}>
      {arrow} {Math.abs(change).toFixed(1)}
    </span>
  )
}

function formatRank(rank: number | null, total: number | null): string {
  if (rank == null || total == null) {
    return '-'
  }
  return `${rank} / ${total}`
}

interface IndustryContextCardProps {
  industry: string
  context: IndustryContext
}

export function IndustryContextCard({ industry, context }: IndustryContextCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>산업 맥락</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-medium truncate">{industry}</span>
          <PhaseBadge phase={context.groupPhase} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetricItem label="산업 RS" value={formatRs(context.avgRs)} />
          <MetricItem label="산업 순위" value={context.rsRank != null ? `${context.rsRank}위` : '-'} />
          <MetricItem label="Phase2 비율" value={formatPct(context.phase2Ratio)} />
          <MetricItem label="산업 내 RS 순위" value={formatRank(context.stockRsRank, context.stockTotalInIndustry)} />
        </div>

        <div className="mt-3 flex items-center gap-4 border-t pt-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">4주 변화</span>
            {formatChangeArrow(context.change4w)}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">8주 변화</span>
            {formatChangeArrow(context.change8w)}
          </div>
        </div>
      </CardContent>
    </Card>
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
