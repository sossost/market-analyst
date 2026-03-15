import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { FundamentalData, QuarterlyFinancial, SepaGrade } from '../types'

const SEPA_GRADE_CLASS_MAP: Record<SepaGrade, string> = {
  S: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  A: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  B: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  C: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  F: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

const BILLION = 1_000_000_000
const MILLION = 1_000_000

function formatRevenue(revenue: number | null): string {
  if (revenue == null) {
    return '-'
  }
  if (Math.abs(revenue) >= BILLION) {
    return `$${(revenue / BILLION).toFixed(1)}B`
  }
  if (Math.abs(revenue) >= MILLION) {
    return `$${(revenue / MILLION).toFixed(0)}M`
  }
  return `$${revenue.toLocaleString()}`
}

function formatEps(eps: number | null): string {
  if (eps == null) {
    return '-'
  }
  return `$${eps.toFixed(2)}`
}

function calcQoQChange(current: number | null, prev: number | null): number | null {
  if (current == null || prev == null || prev === 0) {
    return null
  }
  return ((current - prev) / Math.abs(prev)) * 100
}

function formatQoQ(pct: number | null): string {
  if (pct == null) {
    return '-'
  }
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function getQoQClass(pct: number | null): string {
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

interface SEPAGradeBadgeProps {
  grade: SepaGrade | null
}

function SEPAGradeBadge({ grade }: SEPAGradeBadgeProps) {
  if (grade == null) {
    return (
      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
        등급 없음
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${SEPA_GRADE_CLASS_MAP[grade]}`}
    >
      SEPA {grade}
    </span>
  )
}

interface QuarterlyRowProps {
  current: QuarterlyFinancial
  prev: QuarterlyFinancial | undefined
}

function QuarterlyRow({ current, prev }: QuarterlyRowProps) {
  const epsChange = calcQoQChange(current.epsDiluted, prev?.epsDiluted ?? null)
  const revenueChange = calcQoQChange(current.revenue, prev?.revenue ?? null)

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 text-xs font-mono text-muted-foreground">
        {current.periodEndDate}
      </td>
      <td className="py-2 text-right text-xs font-mono">
        {formatEps(current.epsDiluted)}
      </td>
      <td className={`py-2 text-right text-xs font-semibold ${getQoQClass(epsChange)}`}>
        {formatQoQ(epsChange)}
      </td>
      <td className="py-2 text-right text-xs font-mono">
        {formatRevenue(current.revenue)}
      </td>
      <td className={`py-2 text-right text-xs font-semibold ${getQoQClass(revenueChange)}`}>
        {formatQoQ(revenueChange)}
      </td>
    </tr>
  )
}

interface FundamentalCardProps {
  data: FundamentalData
}

export function FundamentalCard({ data }: FundamentalCardProps) {
  const { score, quarterlyFinancials } = data

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>펀더멘탈 (SEPA)</CardTitle>
          <SEPAGradeBadge grade={score?.grade ?? null} />
        </div>
      </CardHeader>
      <CardContent>
        {score != null && (
          <div className="mb-4 flex items-center gap-4">
            {score.totalScore != null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">총점</span>
                <span className="text-sm font-semibold">{score.totalScore.toFixed(0)}</span>
              </div>
            )}
            {score.scoredDate != null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">기준일</span>
                <span className="text-xs text-muted-foreground font-mono">{score.scoredDate}</span>
              </div>
            )}
          </div>
        )}

        {quarterlyFinancials.length === 0 ? (
          <p className="text-sm text-muted-foreground">분기 재무 데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-xs text-muted-foreground">분기</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">EPS</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">QoQ</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">매출</th>
                  <th className="pb-2 text-right text-xs text-muted-foreground">QoQ</th>
                </tr>
              </thead>
              <tbody>
                {quarterlyFinancials.map((q, idx) => (
                  <QuarterlyRow
                    key={q.periodEndDate}
                    current={q}
                    prev={quarterlyFinancials[idx + 1]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
