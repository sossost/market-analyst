import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { ReportList } from '@/features/reports/components/ReportList'
import { ReportListSkeleton } from '@/features/reports/components/ReportListSkeleton'
import { CardError } from '@/features/dashboard/components/CardError'

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default function ReportsPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">리포트</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        일간/주간 리포트 아카이브
      </p>
      <AsyncBoundary
        pendingFallback={<ReportListSkeleton />}
        errorFallback={<CardError title="리포트 목록" />}
      >
        <ReportList searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}
