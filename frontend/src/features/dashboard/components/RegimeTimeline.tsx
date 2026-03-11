import { RegimeBadge } from '@/features/debates/components/RegimeBadge'

import type { RecentRegime } from '../types'

interface RegimeTimelineProps {
  regimes: RecentRegime[]
}

export function RegimeTimeline({ regimes }: RegimeTimelineProps) {
  if (regimes.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">최근 레짐 추이</span>
      <div className="flex flex-wrap gap-2">
        {regimes.map((item) => (
          <div
            key={item.regimeDate}
            className="flex flex-col items-center gap-1"
          >
            <span className="text-xs text-muted-foreground">
              {item.regimeDate.slice(5)}
            </span>
            <RegimeBadge regime={item.regime} />
          </div>
        ))}
      </div>
    </div>
  )
}
