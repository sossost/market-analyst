import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AnalysisReportCard } from '@/features/recommendations/components/AnalysisReportCard'
import { fetchLatestAnalysisReport } from '@/features/recommendations/lib/supabase-queries'
import { BasicInfoCard } from '@/features/stock-search/components/BasicInfoCard'
import { FundamentalCard } from '@/features/stock-search/components/FundamentalCard'
import { IndustryContextCard } from '@/features/stock-search/components/IndustryContextCard'
import { RSCard } from '@/features/stock-search/components/RSCard'
import { RecommendationHistoryCard } from '@/features/stock-search/components/RecommendationHistoryCard'
import { SectorContextCard } from '@/features/stock-search/components/SectorContextCard'
import { StockSearchInput } from '@/features/stock-search/components/StockSearchInput'
import { TechnicalCard } from '@/features/stock-search/components/TechnicalCard'
import {
  fetchFundamentalData,
  fetchIndustryContext,
  fetchRecommendationHistory,
  fetchSectorContext,
  fetchStockProfile,
} from '@/features/stock-search/lib/supabase-queries'

interface Props {
  params: Promise<{ symbol: string }>
}

export default async function StockDetailPage({ params }: Props) {
  const { symbol } = await params
  const uppercaseSymbol = symbol.toUpperCase()

  const profile = await fetchStockProfile(uppercaseSymbol)

  if (profile == null) {
    notFound()
  }

  const [fundamentalData, sectorContext, industryContext, recommendations, analysisReport] =
    await Promise.all([
      fetchFundamentalData(uppercaseSymbol),
      profile.sector != null
        ? fetchSectorContext(profile.sector, profile.rsScore)
        : Promise.resolve(null),
      profile.industry != null
        ? fetchIndustryContext(profile.industry, profile.rsScore)
        : Promise.resolve(null),
      fetchRecommendationHistory(uppercaseSymbol),
      fetchLatestAnalysisReport(uppercaseSymbol),
    ])

  return (
    <main className="p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/stocks"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; 종목 검색
        </Link>
        <StockSearchInput className="sm:max-w-sm" />
      </div>

      <div className="flex flex-col gap-4">
        <BasicInfoCard profile={profile} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TechnicalCard profile={profile} />
          <RSCard profile={profile} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FundamentalCard data={fundamentalData} />
          <div className="flex flex-col gap-4">
            {sectorContext != null && profile.sector != null && (
              <SectorContextCard sector={profile.sector} context={sectorContext} />
            )}
            {industryContext != null && profile.industry != null && (
              <IndustryContextCard industry={profile.industry} context={industryContext} />
            )}
          </div>
        </div>

        <RecommendationHistoryCard records={recommendations} />
        <AnalysisReportCard report={analysisReport} />
      </div>
    </main>
  )
}
