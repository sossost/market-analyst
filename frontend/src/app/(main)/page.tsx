import { Suspense } from 'react'

import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { DailyReportCard } from '@/features/dashboard/components/DailyReportCard'
import { ActiveThesesCard } from '@/features/dashboard/components/ActiveThesesCard'
import { RecommendationCard } from '@/features/dashboard/components/RecommendationCard'
import { MarketRegimeCard } from '@/features/dashboard/components/MarketRegimeCard'
import { CardSkeleton } from '@/features/dashboard/components/CardSkeleton'
import { CardError } from '@/features/dashboard/components/CardError'

export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold">대시보드</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ErrorBoundary fallback={<CardError title="오늘의 리포트" />}>
          <Suspense fallback={<CardSkeleton title="오늘의 리포트" />}>
            <DailyReportCard />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary fallback={<CardError title="시장 레짐" />}>
          <Suspense fallback={<CardSkeleton title="시장 레짐" />}>
            <MarketRegimeCard />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary fallback={<CardError title="Active Thesis" />}>
          <Suspense fallback={<CardSkeleton title="Active Thesis" />}>
            <ActiveThesesCard />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary fallback={<CardError title="추천 성과 현황" />}>
          <Suspense fallback={<CardSkeleton title="추천 성과 현황" />}>
            <RecommendationCard />
          </Suspense>
        </ErrorBoundary>
      </div>
    </main>
  )
}
