import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import { PHASE_LABEL } from '@/features/recommendations/constants'
import { SEPA_GRADE_LABEL } from '../constants'
import type { WatchlistStockDetail } from '../types'

interface EntryFactorCardProps {
  stock: WatchlistStockDetail
}

export function EntryFactorCard({ stock }: EntryFactorCardProps) {
  const factors = [
    {
      label: 'Phase',
      value: PHASE_LABEL[stock.entryPhase] ?? `Phase ${stock.entryPhase}`,
      pass: stock.entryPhase === 2,
    },
    {
      label: '섹터 RS',
      value:
        stock.entrySectorRs != null
          ? `${Number(stock.entrySectorRs).toFixed(1)}%`
          : '-',
      pass: stock.entrySectorRs != null,
    },
    {
      label: '개별 RS',
      value: stock.entryRsScore != null ? String(stock.entryRsScore) : '-',
      pass: stock.entryRsScore != null,
    },
    {
      label: '서사 근거',
      value: stock.entryReason != null ? '있음' : '없음',
      pass: stock.entryReason != null,
    },
    {
      label: 'SEPA',
      value:
        stock.entrySepaGrade != null
          ? (SEPA_GRADE_LABEL[stock.entrySepaGrade] ?? stock.entrySepaGrade)
          : '-',
      pass:
        stock.entrySepaGrade === 'S' || stock.entrySepaGrade === 'A',
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>5중 교집합 근거</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {factors.map((factor) => (
            <div
              key={factor.label}
              className="flex flex-col items-center gap-1 rounded-lg border p-3"
            >
              <span className="text-xs text-muted-foreground">
                {factor.label}
              </span>
              <span className="text-sm font-medium">{factor.value}</span>
              <span
                className={
                  factor.pass
                    ? 'text-xs text-green-600 dark:text-green-400'
                    : 'text-xs text-muted-foreground'
                }
              >
                {factor.pass ? '통과' : '-'}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
