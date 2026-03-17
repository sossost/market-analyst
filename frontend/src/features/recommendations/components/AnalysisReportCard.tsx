import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { MarkdownContent } from '@/shared/components/ui/MarkdownContent'
import { formatDate } from '@/shared/lib/formatDate'

import type { AnalysisReport } from '../types'

interface AnalysisReportCardProps {
  report: AnalysisReport | null
}

type RequiredReportKey = keyof Omit<
  AnalysisReport,
  'id' | 'symbol' | 'recommendationDate' | 'earningsCallHighlights' | 'generatedAt'
>

interface ReportSection {
  key: RequiredReportKey
  title: string
}

const REPORT_SECTIONS: ReportSection[] = [
  { key: 'investmentSummary', title: '투자 포인트 요약' },
  { key: 'technicalAnalysis', title: '기술적 분석' },
  { key: 'fundamentalTrend', title: '실적 트렌드' },
  { key: 'valuationAnalysis', title: '밸류에이션 분석' },
  { key: 'sectorPositioning', title: '섹터·업종 포지셔닝' },
  { key: 'marketContext', title: '시장 맥락' },
  { key: 'riskFactors', title: '리스크 요인' },
]

export function AnalysisReportCard({ report }: AnalysisReportCardProps) {
  if (report == null) {
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">기업 분석 리포트</h2>
        <span className="text-xs text-muted-foreground">
          생성일: {formatDate(report.generatedAt)}
        </span>
      </div>

      {REPORT_SECTIONS.map((section) => (
        <Card key={section.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownContent content={report[section.key]} />
          </CardContent>
        </Card>
      ))}

      {report.earningsCallHighlights != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">어닝콜 하이라이트</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownContent content={report.earningsCallHighlights} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
