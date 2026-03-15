import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { RecommendationRecord } from '../types'

function formatPct(pct: number | null): string {
  if (pct == null) {
    return '-'
  }
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function getPctClass(pct: number | null): string {
  if (pct == null) {
    return 'text-muted-foreground'
  }
  if (pct > 0) {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (pct < 0) {
    return 'text-red-600 dark:text-red-400'
  }
  return 'text-muted-foreground'
}

function formatPrice(price: number | null): string {
  if (price == null) {
    return '-'
  }
  return `$${price.toFixed(2)}`
}

interface StatusBadgeProps {
  status: 'active' | 'closed'
}

function StatusBadge({ status }: StatusBadgeProps) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
        보유 중
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      종료
    </span>
  )
}

interface RecommendationHistoryCardProps {
  records: RecommendationRecord[]
}

export function RecommendationHistoryCard({ records }: RecommendationHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>추천 이력</CardTitle>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground">추천 이력 없음</p>
            <p className="mt-1 text-xs text-muted-foreground">
              이 종목은 에이전트 추천 이력이 없습니다.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-xs text-muted-foreground">추천일</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">진입가</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">현재가</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">수익률</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">최대</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">상태</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-2 text-xs font-mono text-muted-foreground">
                      {record.recommendationDate}
                    </td>
                    <td className="py-2 text-right text-xs font-mono">
                      {formatPrice(record.entryPrice)}
                    </td>
                    <td className="py-2 text-right text-xs font-mono">
                      {formatPrice(record.currentPrice)}
                    </td>
                    <td className={`py-2 text-right text-xs font-semibold ${getPctClass(record.pnlPercent)}`}>
                      {formatPct(record.pnlPercent)}
                    </td>
                    <td className={`py-2 text-right text-xs ${getPctClass(record.maxPnlPercent)}`}>
                      {formatPct(record.maxPnlPercent)}
                    </td>
                    <td className="py-2 text-right">
                      <StatusBadge status={record.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
