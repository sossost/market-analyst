import Link from 'next/link'

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { RegimeBadge } from '@/features/debates/components/RegimeBadge'

import { fetchRecentRegimes } from '../lib/supabase-queries'
import { RegimeTimeline } from './RegimeTimeline'

export async function MarketRegimeCard() {
  const regimes = await fetchRecentRegimes()
  const latestRegime = regimes.length > 0 ? regimes[0] : null

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>시장 레짐</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {latestRegime == null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            레짐 데이터가 없습니다
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <RegimeBadge
                regime={latestRegime.regime}
                confidence={latestRegime.confidence}
              />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground line-clamp-4">
              {latestRegime.rationale}
            </p>
            <RegimeTimeline regimes={regimes} />
          </div>
        )}
      </CardContent>
      {latestRegime != null && (
        <CardFooter>
          <Link
            href={`/debates/${latestRegime.regimeDate}`}
            className="text-sm text-primary hover:underline"
          >
            토론 보기 →
          </Link>
        </CardFooter>
      )}
    </Card>
  )
}
