import Link from 'next/link'

import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import { fetchLatestDailyReport } from '../lib/supabase-queries'
import { MetricItem } from './MetricItem'

export async function DailyReportCard() {
  const report = await fetchLatestDailyReport()

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>오늘의 리포트</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {report == null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            리포트 데이터가 없습니다
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
              <MetricItem label="리포트 날짜" value={report.reportDate} />
              <MetricItem
                label="Phase 2 비율"
                value={`${report.phase2Ratio.toFixed(1)}%`}
              />
              <MetricItem
                label="총 분석 종목"
                value={`${report.totalAnalyzed}종목`}
              />
            </div>
            <MetricItem
              label="추천 종목 수"
              value={`${report.symbolCount}종목`}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">주도 섹터</span>
              {report.leadingSectors.length === 0 ? (
                <span className="text-sm font-medium">-</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {report.leadingSectors.map((sector) => (
                    <Badge key={sector} variant="outline">
                      {sector}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
      {report != null && (
        <CardFooter>
          <Link
            href={`/reports/${report.reportDate}`}
            className="text-sm text-primary hover:underline"
          >
            상세 보기 →
          </Link>
        </CardFooter>
      )}
    </Card>
  )
}
