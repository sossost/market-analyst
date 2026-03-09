import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MarketSummaryCard } from '@/features/reports/components/MarketSummaryCard'
import { RecommendedStockTable } from '@/features/reports/components/RecommendedStockTable'
import { ReportTypeBadge } from '@/features/reports/components/ReportTypeBadge'
import { fetchReportByDate } from '@/features/reports/lib/supabase-queries'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatDate } from '@/shared/lib/formatDate'

const MS_PER_SECOND = 1000

interface Props {
  params: Promise<{ date: string }>
}

export default async function ReportDetailPage({ params }: Props) {
  const { date } = await params

  const report = await fetchReportByDate(date)

  if (report == null) {
    notFound()
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <Link
          href="/reports"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; 리포트 목록
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          {formatDate(date)} 리포트
          <ReportTypeBadge type={report.type} />
        </h1>
      </div>

      <div className="flex flex-col gap-6">
        <MarketSummaryCard summary={report.marketSummary} />

        <section>
          <h2 className="mb-3 text-lg font-semibold">추천 종목</h2>
          <RecommendedStockTable stocks={report.reportedSymbols} />
        </section>

        <MetadataSection
          model={report.metadata.model}
          tokensInput={report.metadata.tokensUsed.input}
          tokensOutput={report.metadata.tokensUsed.output}
          toolCalls={report.metadata.toolCalls}
          executionTime={report.metadata.executionTime}
        />
      </div>
    </main>
  )
}

function MetadataSection({
  model,
  tokensInput,
  tokensOutput,
  toolCalls,
  executionTime,
}: {
  model: string
  tokensInput: number
  tokensOutput: number
  toolCalls: number
  executionTime: number
}) {
  const executionTimeSec = (executionTime / MS_PER_SECOND).toFixed(1)

  return (
    <Card>
      <CardHeader>
        <CardTitle>실행 정보</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricItem label="실행 모델" value={model || '-'} />
          <MetricItem
            label="토큰 사용량"
            value={`입력 ${tokensInput.toLocaleString()} / 출력 ${tokensOutput.toLocaleString()}`}
          />
          <MetricItem label="도구 호출" value={`${toolCalls}회`} />
          <MetricItem label="실행 시간" value={`${executionTimeSec}초`} />
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
