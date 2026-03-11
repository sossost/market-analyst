import {
  fetchLatestDailyReport,
  fetchActiveTheses,
  fetchActiveRecommendations,
  fetchRecentRegimes,
  calculateRecommendationStats,
} from '@/features/dashboard'
import { DailyReportCard } from '@/features/dashboard/components/DailyReportCard'
import { ActiveThesesCard } from '@/features/dashboard/components/ActiveThesesCard'
import { RecommendationCard } from '@/features/dashboard/components/RecommendationCard'
import { MarketRegimeCard } from '@/features/dashboard/components/MarketRegimeCard'

function unwrapSettled<T>(
  result: PromiseSettledResult<T>,
  label: string,
): T | null {
  if (result.status === 'rejected') {
    console.error(`[Dashboard] ${label} failed:`, result.reason)
    return null
  }
  return result.value
}

export default async function HomePage() {
  const [reportResult, thesesResult, recommendationsResult, regimesResult] =
    await Promise.allSettled([
      fetchLatestDailyReport(),
      fetchActiveTheses(),
      fetchActiveRecommendations(),
      fetchRecentRegimes(),
    ])

  const report = unwrapSettled(reportResult, 'fetchLatestDailyReport')
  const thesesData = unwrapSettled(thesesResult, 'fetchActiveTheses')
  const recommendations = unwrapSettled(recommendationsResult, 'fetchActiveRecommendations')
  const regimes = unwrapSettled(regimesResult, 'fetchRecentRegimes')

  const recommendationStats = recommendations != null
    ? calculateRecommendationStats(recommendations)
    : calculateRecommendationStats([])

  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold">대시보드</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DailyReportCard report={report} />
        <MarketRegimeCard regimes={regimes ?? []} />
        <ActiveThesesCard
          theses={thesesData?.items ?? []}
          totalCount={thesesData?.totalCount ?? 0}
        />
        <RecommendationCard stats={recommendationStats} />
      </div>
    </main>
  )
}
