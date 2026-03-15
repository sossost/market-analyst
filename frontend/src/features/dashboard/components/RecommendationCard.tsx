import { cn } from '@/shared/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { RecommendationSummary } from '../types'
import {
  fetchActiveRecommendations,
  calculateRecommendationStats,
} from '../lib/supabase-queries'
import { MetricItem } from './MetricItem'

export async function RecommendationCard() {
  const recommendations = await fetchActiveRecommendations()
  const stats = calculateRecommendationStats(recommendations)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>추천 성과 현황</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {stats.activeCount === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            활성 추천 종목이 없습니다
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <MetricItem
                label="활성 종목 수"
                value={`${stats.activeCount}종목`}
              />
              <MetricItem
                label="승률"
                value={`${stats.winRate.toFixed(1)}%`}
              />
              <MetricItem
                label="평균 수익률"
                value={`${stats.avgPnlPercent >= 0 ? '+' : ''}${stats.avgPnlPercent.toFixed(2)}%`}
              />
              <MetricItem
                label="최대 수익률"
                value={`${stats.maxPnlPercent >= 0 ? '+' : ''}${stats.maxPnlPercent.toFixed(2)}%`}
              />
              <MetricItem
                label="평균 보유일"
                value={`${Math.round(stats.avgDaysHeld)}일`}
              />
            </div>
            {stats.topItems.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  상위 {stats.topItems.length}종목 (수익률 순)
                </span>
                <div className="flex flex-col gap-1">
                  {stats.topItems.map((item) => (
                    <TopRecommendationItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TopRecommendationItem({ item }: { item: RecommendationSummary }) {
  const pnl = item.pnlPercent
  const isPositive = pnl != null && pnl > 0
  const isNegative = pnl != null && pnl < 0

  const pnlText =
    pnl == null
      ? '-'
      : `${isPositive ? '+' : ''}${pnl.toFixed(2)}%`

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">{item.symbol}</span>
      <span
        className={cn('font-medium tabular-nums', {
          'text-green-600': isPositive,
          'text-red-600': isNegative,
          'text-muted-foreground': pnl == null || pnl === 0,
        })}
      >
        {pnlText}
      </span>
    </div>
  )
}
