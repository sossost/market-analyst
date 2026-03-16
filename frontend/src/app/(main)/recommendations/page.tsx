import { Suspense } from 'react'

import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { CardError } from '@/features/dashboard/components/CardError'
import { RecommendationTable } from '@/features/recommendations/components/RecommendationTable'
import { RecommendationTableSkeleton } from '@/features/recommendations/components/RecommendationTableSkeleton'
import { StatusFilterTabs } from '@/features/recommendations/components/StatusFilterTabs'

interface Props {
  searchParams: Promise<{ page?: string; status?: string }>
}

export default function RecommendationsPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">추천 종목</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        주간 에이전트 추천 종목 성과 트래킹
      </p>
      <Suspense fallback={<div className="mt-4 h-9 w-64 rounded-lg bg-muted" />}>
        <StatusFilterTabs />
      </Suspense>
      <AsyncBoundary
        pendingFallback={<RecommendationTableSkeleton />}
        errorFallback={<CardError title="추천 종목 목록" />}
      >
        <RecommendationTable searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}
