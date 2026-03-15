import { notFound } from 'next/navigation'

import { BasicInfoCard } from '@/features/stock-search/components/BasicInfoCard'
import { RSCard } from '@/features/stock-search/components/RSCard'
import { TechnicalCard } from '@/features/stock-search/components/TechnicalCard'
import { fetchStockProfile } from '@/features/stock-search/lib/supabase-queries'

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
      </div>
    </main>
  )
}
