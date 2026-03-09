import Link from 'next/link'

import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatDate } from '@/shared/lib/formatDate'

import type { ReportSummary } from '../types'
import { ReportTypeBadge } from './ReportTypeBadge'

const MAX_VISIBLE_SECTORS = 3

interface ReportListItemProps {
  report: ReportSummary
}

export function ReportListItem({ report }: ReportListItemProps) {
  return (
    <Link href={`/reports/${report.reportDate}`} className="block">
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {formatDate(report.reportDate)}
            <ReportTypeBadge type={report.type} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricItem
              label="추천 종목"
              value={`${report.symbolCount}종목`}
            />
            <MetricItem
              label="Phase 2 비율"
              value={`${report.phase2Ratio.toFixed(1)}%`}
            />
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">주도 섹터</span>
              <div className="flex flex-wrap gap-1">
                {report.leadingSectors.length === 0 && (
                  <span className="text-sm font-medium">-</span>
                )}
                {report.leadingSectors
                  .slice(0, MAX_VISIBLE_SECTORS)
                  .map((sector) => (
                    <Badge key={sector} variant="outline">
                      {sector}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>
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
