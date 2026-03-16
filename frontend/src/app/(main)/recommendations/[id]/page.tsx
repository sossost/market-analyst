import Link from 'next/link'
import { notFound } from 'next/navigation'

import { RecommendationDetail } from '@/features/recommendations/components/RecommendationDetail'
import { RecommendationStatusBadge } from '@/features/recommendations/components/RecommendationStatusBadge'
import { fetchRecommendationById } from '@/features/recommendations/lib/supabase-queries'
import { formatDate } from '@/shared/lib/formatDate'

interface Props {
  params: Promise<{ id: string }>
}

export default async function RecommendationDetailPage({ params }: Props) {
  const { id } = await params
  const numericId = parseInt(id, 10)

  if (isNaN(numericId) || numericId <= 0 || String(numericId) !== id) {
    notFound()
  }

  const recommendation = await fetchRecommendationById(numericId)

  if (recommendation == null) {
    notFound()
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <Link
          href="/recommendations"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; 추천 목록
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          {recommendation.symbol} —{' '}
          {formatDate(recommendation.recommendationDate)} 추천
        </h1>
        <RecommendationStatusBadge status={recommendation.status} />
      </div>

      <RecommendationDetail recommendation={recommendation} />
    </main>
  )
}
