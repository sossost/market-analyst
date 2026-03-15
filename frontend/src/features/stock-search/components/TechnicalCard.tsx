import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { StockProfile } from '../types'
import { PhaseBadge } from './PhaseBadge'


function formatPctChange(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function getPctClass(pct: number): string {
  if (pct > 0) {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (pct < 0) {
    return 'text-red-600 dark:text-red-400'
  }
  return 'text-muted-foreground'
}

function calcPctFromMa(close: number, ma: number | null): number | null {
  if (ma == null || ma === 0) {
    return null
  }
  return ((close - ma) / ma) * 100
}

interface MARowProps {
  label: string
  close: number
  ma: number | null
}

function MARow({ label, close, ma }: MARowProps) {
  const pct = calcPctFromMa(close, ma)

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground">
          {ma != null ? ma.toFixed(2) : '-'}
        </span>
        {pct != null ? (
          <span className={`text-xs font-semibold ${getPctClass(pct)}`}>
            {formatPctChange(pct)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>
    </div>
  )
}

interface TechnicalCardProps {
  profile: StockProfile
}

export function TechnicalCard({ profile }: TechnicalCardProps) {
  const { close, ma20, ma50, ma100, ma200, phase, pctFromHigh52w, pctFromLow52w } = profile

  const maValues: Array<{ label: string; value: number | null }> = [
    { label: 'MA20', value: ma20 },
    { label: 'MA50', value: ma50 },
    { label: 'MA100', value: ma100 },
    { label: 'MA200', value: ma200 },
  ]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>기술적 위치</CardTitle>
          <PhaseBadge phase={phase} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">현재가</span>
            <span className="text-lg font-bold font-mono">
              {close != null ? `$${close.toFixed(2)}` : '-'}
            </span>
          </div>
          {pctFromHigh52w != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">52주 고점 대비</span>
              <span className={`text-sm font-semibold ${getPctClass(pctFromHigh52w)}`}>
                {formatPctChange(pctFromHigh52w)}
              </span>
            </div>
          )}
          {pctFromLow52w != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">52주 저점 대비</span>
              <span className={`text-sm font-semibold ${getPctClass(pctFromLow52w)}`}>
                {formatPctChange(pctFromLow52w)}
              </span>
            </div>
          )}
        </div>

        {close != null && (
          <div className="divide-y rounded-md border px-3">
            {maValues.map(({ label, value }) => (
              <MARow key={label} label={label} close={close} ma={value} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
