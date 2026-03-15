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
import type { SectorContext } from '../types'
import { PhaseBadge } from './PhaseBadge'

interface SectorContextCardProps {
  sector: string
  context: SectorContext
}

export function SectorContextCard({ sector, context }: SectorContextCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>섹터 맥락</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-medium">{sector}</span>
          <PhaseBadge phase={context.groupPhase} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetricItem label="섹터 RS" value={formatRs(context.avgRs)} />
          <MetricItem label="섹터 순위" value={context.rsRank != null ? `${context.rsRank}위` : '-'} />
          <MetricItem label="Phase2 비율" value={formatPct(context.phase2Ratio)} />
          <MetricItem label="섹터 내 RS 순위" value={formatRank(context.stockRsRank, context.stockTotalInSector)} />
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
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">12주 변화</span>
            {formatChangeArrow(context.change12w)}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
