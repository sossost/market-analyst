import { notFound } from 'next/navigation'

import { BasicInfoCard } from '@/features/stock-search/components/BasicInfoCard'
import { FundamentalCard } from '@/features/stock-search/components/FundamentalCard'
import { IndustryContextCard } from '@/features/stock-search/components/IndustryContextCard'
import { RSCard } from '@/features/stock-search/components/RSCard'
import { SectorContextCard } from '@/features/stock-search/components/SectorContextCard'
import { TechnicalCard } from '@/features/stock-search/components/TechnicalCard'
import {
  fetchFundamentalData,
  fetchIndustryContext,
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

  const [fundamentalData, sectorContext, industryContext] = await Promise.all([
    fetchFundamentalData(uppercaseSymbol),
    profile.sector !== ''
      ? fetchSectorContext(profile.sector, profile.rsScore)
      : Promise.resolve(null),
    profile.industry !== ''
      ? fetchIndustryContext(profile.industry, profile.rsScore)
      : Promise.resolve(null),
  ])

  return (
    <main className="p-6">
      <div className="mb-6">
        <a
          href="/stocks"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; 종목 검색
        </a>
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
            {sectorContext != null && (
              <SectorContextCard sector={profile.sector} context={sectorContext} />
            )}
            {industryContext != null && (
              <IndustryContextCard industry={profile.industry} context={industryContext} />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
