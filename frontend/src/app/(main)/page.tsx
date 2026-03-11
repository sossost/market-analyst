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

export default async function HomePage() {
  const [reportResult, thesesResult, recommendationsResult, regimesResult] =
    await Promise.allSettled([
      fetchLatestDailyReport(),
      fetchActiveTheses(),
      fetchActiveRecommendations(),
      fetchRecentRegimes(),
    ])

  if (reportResult.status === 'rejected') {
    console.error('[Dashboard] fetchLatestDailyReport failed:', reportResult.reason)
  }
  if (thesesResult.status === 'rejected') {
    console.error('[Dashboard] fetchActiveTheses failed:', thesesResult.reason)
  }
  if (recommendationsResult.status === 'rejected') {
    console.error('[Dashboard] fetchActiveRecommendations failed:', recommendationsResult.reason)
  }
  if (regimesResult.status === 'rejected') {
    console.error('[Dashboard] fetchRecentRegimes failed:', regimesResult.reason)
  }

  const report =
    reportResult.status === 'fulfilled' ? reportResult.value : null

  const thesesData =
    thesesResult.status === 'fulfilled' ? thesesResult.value : null

  const recommendations =
    recommendationsResult.status === 'fulfilled'
      ? recommendationsResult.value
      : null

  const regimes =
    regimesResult.status === 'fulfilled' ? regimesResult.value : null

  const recommendationStats =
    recommendations != null
      ? calculateRecommendationStats(recommendations)
      : null

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
        <RecommendationCard
          stats={
            recommendationStats ?? {
              activeCount: 0,
              winRate: 0,
              avgPnlPercent: 0,
              maxPnlPercent: 0,
              avgDaysHeld: 0,
              topItems: [],
            }
          }
        />
      </div>
    </main>
  )
}

