import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { MarketSummary } from '../types'

interface MarketSummaryCardProps {
  summary: MarketSummary
}

export function MarketSummaryCard({ summary }: MarketSummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>시장 요약</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricItem
            label="Phase 2 비율"
            value={`${summary.phase2Ratio.toFixed(1)}%`}
          />
          <MetricItem
            label="총 분석 종목"
            value={`${summary.totalAnalyzed}종목`}
          />
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <span className="text-xs text-muted-foreground">주도 섹터</span>
            <div className="flex flex-wrap gap-1">
              {summary.leadingSectors.length === 0 && (
                <span className="text-sm font-medium">-</span>
              )}
              {summary.leadingSectors.map((sector) => (
                <Badge key={sector} variant="outline">
                  {sector}
                </Badge>
              ))}
            </div>
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
