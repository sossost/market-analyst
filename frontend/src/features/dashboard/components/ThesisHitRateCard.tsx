import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { ThesisStats, CaptureLeadStats } from '../types'
import { fetchThesisStats, fetchCaptureLeadStats } from '../lib/supabase-queries'
import { MetricItem } from './MetricItem'

const MIN_THESIS_SAMPLES = 20
const CAPTURE_LEAD_MIN_SAMPLES = 10

export async function ThesisHitRateCard() {
  const [thesisStats, captureLeadStats] = await Promise.all([
    fetchThesisStats(),
    fetchCaptureLeadStats(),
  ])

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Thesis KPI</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="flex flex-col gap-4">
          <ThesisHitRateSection stats={thesisStats} />
          <CaptureLeadSection stats={captureLeadStats} />
          <ThesisBreakdownSection stats={thesisStats} />
        </div>
      </CardContent>
    </Card>
  )
}

function ThesisHitRateSection({ stats }: { stats: ThesisStats }) {
  const resolved = stats.confirmedCount + stats.invalidatedCount
  const hasEnoughData = resolved >= MIN_THESIS_SAMPLES

  if (resolved === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Thesis 적중률
        </span>
        <span className="text-sm text-muted-foreground">
          데이터 수집 중 (0/{MIN_THESIS_SAMPLES}건)
        </span>
      </div>
    )
  }

  const hitRate = (stats.confirmedCount / resolved) * 100

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        Thesis 적중률
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">
          {hitRate.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">
          ({stats.confirmedCount}/{resolved}건)
        </span>
      </div>
      {!hasEnoughData && (
        <span className="text-xs text-muted-foreground">
          측정 중 ({resolved}/{MIN_THESIS_SAMPLES}건)
        </span>
      )}
    </div>
  )
}

function CaptureLeadSection({ stats }: { stats: CaptureLeadStats }) {
  if (!stats.measurable) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          포착 선행성
        </span>
        <span className="text-sm text-muted-foreground">
          측정 중 ({stats.totalResolved}/{CAPTURE_LEAD_MIN_SAMPLES}건)
        </span>
      </div>
    )
  }

  return (
    <MetricItem
      label="포착 선행성"
      value={`평균 ${stats.avgLeadDays}일`}
    />
  )
}

function ThesisBreakdownSection({ stats }: { stats: ThesisStats }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        Thesis 현황
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricItem label="ACTIVE" value={`${stats.activeCount}`} />
        <MetricItem label="CONFIRMED" value={`${stats.confirmedCount}`} />
        <MetricItem label="INVALIDATED" value={`${stats.invalidatedCount}`} />
        <MetricItem label="EXPIRED" value={`${stats.expiredCount}`} />
      </div>
    </div>
  )
}
