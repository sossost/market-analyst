import { formatDate } from '@/shared/lib/formatDate'

import type { LearningSummary } from '../types'

interface Props {
  summary: LearningSummary
}

export function LearningsSummaryCards({ summary }: Props) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <SummaryCard
        label="활성 원칙"
        value={`${summary.activePrincipleCount}개`}
      />
      <SummaryCard
        label="평균 Hit Rate"
        value={
          summary.averageHitRate != null
            ? `${(summary.averageHitRate * 100).toFixed(1)}%`
            : '-'
        }
      />
      <SummaryCard
        label="최근 검증일"
        value={
          summary.lastVerifiedDate != null
            ? formatDate(summary.lastVerifiedDate)
            : '-'
        }
      />
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}
