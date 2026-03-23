import Link from 'next/link'
import { notFound } from 'next/navigation'

import { WatchlistDetail } from '@/features/watchlist/components/WatchlistDetail'
import { WatchlistStatusBadge } from '@/features/watchlist/components/WatchlistStatusBadge'
import { fetchWatchlistStockById } from '@/features/watchlist/lib/supabase-queries'
import { formatDate } from '@/shared/lib/formatDate'

interface Props {
  params: Promise<{ id: string }>
}

export default async function WatchlistDetailPage({ params }: Props) {
  const { id } = await params
  const numericId = parseInt(id, 10)

  if (isNaN(numericId) || numericId <= 0 || String(numericId) !== id) {
    notFound()
  }

  const stock = await fetchWatchlistStockById(numericId)

  if (stock == null) {
    notFound()
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <Link
          href="/watchlist"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; 관심종목 목록
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          {stock.symbol} — {formatDate(stock.entryDate)} 등록
        </h1>
        <WatchlistStatusBadge status={stock.status} />
      </div>

      <WatchlistDetail stock={stock} />
    </main>
  )
}
