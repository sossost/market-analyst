import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { StockProfile } from '../types'

const RS_GAUGE_MAX = 100
const RS_STRONG_THRESHOLD = 80
const RS_MODERATE_THRESHOLD = 50

function getRsGaugeColor(score: number): string {
  if (score >= RS_STRONG_THRESHOLD) {
    return 'bg-emerald-500'
  }
  if (score >= RS_MODERATE_THRESHOLD) {
    return 'bg-amber-500'
  }
  return 'bg-red-500'
}

function getRsLabel(score: number): string {
  if (score >= RS_STRONG_THRESHOLD) {
    return '강세'
  }
  if (score >= RS_MODERATE_THRESHOLD) {
    return '중립'
  }
  return '약세'
}

function formatChangeArrow(change: number | null): string {
  if (change == null) {
    return '-'
  }
  const arrow = change >= 0 ? '▲' : '▼'
  const absChange = Math.abs(change).toFixed(1)
  return `${arrow} ${absChange}`
}

function getChangeClass(change: number | null): string {
  if (change == null) {
    return 'text-muted-foreground'
  }
  if (change > 0) {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (change < 0) {
    return 'text-red-600 dark:text-red-400'
  }
  return 'text-muted-foreground'
}

interface RSCardProps {
  profile: StockProfile
}

export function RSCard({ profile }: RSCardProps) {
  const { rsScore } = profile
  const gaugeWidth = rsScore != null
    ? Math.min(Math.max(rsScore, 0), RS_GAUGE_MAX)
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>상대강도 (RS)</CardTitle>
      </CardHeader>
      <CardContent>
        {rsScore == null ? (
          <p className="text-sm text-muted-foreground">RS 데이터 없음</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-bold font-mono">{rsScore.toFixed(1)}</span>
              <span className={`text-sm font-semibold ${rsScore >= RS_STRONG_THRESHOLD
                ? 'text-emerald-600 dark:text-emerald-400'
                : rsScore >= RS_MODERATE_THRESHOLD
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {getRsLabel(rsScore)}
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${getRsGaugeColor(rsScore)}`}
                style={{ width: `${gaugeWidth}%` }}
              />
            </div>

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
