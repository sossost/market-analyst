import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AnalysisReportCard } from '@/features/recommendations/components/AnalysisReportCard'
import { RecommendationDetail } from '@/features/recommendations/components/RecommendationDetail'
import { RecommendationStatusBadge } from '@/features/recommendations/components/RecommendationStatusBadge'
import {
  fetchAnalysisReport,
  fetchRecommendationById,
} from '@/features/recommendations/lib/supabase-queries'
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

  // recommendation fetch 완료 후 symbol과 date가 확정되어야 리포트 fetch 가능
  // recommendation 자체가 없으면 notFound()로 early return되므로 직렬이 맞음
  const analysisReport = await fetchAnalysisReport(
    recommendation.symbol,
    recommendation.recommendationDate,
  )

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

      <div className="flex flex-col gap-8">
        <RecommendationDetail recommendation={recommendation} />
        <AnalysisReportCard report={analysisReport} />
      </div>
    </main>
  )
}
