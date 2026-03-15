import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import {
  MetricItem,
  formatChangeArrow,
  formatPct,
  formatRank,
  formatRs,
} from '../lib/formatters'
import type { IndustryContext } from '../types'
import { PhaseBadge } from './PhaseBadge'

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
