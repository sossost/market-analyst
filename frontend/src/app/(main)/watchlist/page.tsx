import { Suspense } from 'react'

import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { CardError } from '@/features/dashboard/components/CardError'
import { WatchlistTable } from '@/features/watchlist/components/WatchlistTable'
import { WatchlistTableSkeleton } from '@/features/watchlist/components/WatchlistTableSkeleton'
import { WatchlistStatusFilterTabs } from '@/features/watchlist/components/WatchlistStatusFilterTabs'

interface Props {
  searchParams: Promise<{ page?: string; status?: string }>
}

export default function WatchlistPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">관심종목</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        5중 교집합 게이트 통과 종목의 90일 Phase 궤적 추적
      </p>
      <Suspense fallback={<div className="mt-4 h-9 w-64 rounded-lg bg-muted" />}>
        <WatchlistStatusFilterTabs />
      </Suspense>
      <AsyncBoundary
        pendingFallback={<WatchlistTableSkeleton />}
        errorFallback={<CardError title="관심종목 목록" />}
      >
        <WatchlistTable searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}
