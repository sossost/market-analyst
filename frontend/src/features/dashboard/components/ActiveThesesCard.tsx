import Link from 'next/link'

import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { ThesisBadge } from '@/features/debates/components/ThesisBadge'
import { getPersonaLabel } from '@/features/debates/constants'

import type { ActiveThesis } from '../types'

const ACTIVE_THESES_DISPLAY_LIMIT = 10

interface ActiveThesesCardProps {
  theses: ActiveThesis[]
  totalCount: number
}

export function ActiveThesesCard({
  theses,
  totalCount,
}: ActiveThesesCardProps) {
  const hasMore = totalCount > ACTIVE_THESES_DISPLAY_LIMIT

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Thesis</CardTitle>
      </CardHeader>
      <CardContent>
        {theses.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            활성 thesis가 없습니다
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {theses.map((thesis) => (
              <ThesisItem key={thesis.id} thesis={thesis} />
            ))}
            {hasMore && (
              <p className="text-center text-xs text-muted-foreground">
                외 {totalCount - ACTIVE_THESES_DISPLAY_LIMIT}건 더 있음
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Link
          href="/debates"
          className="text-sm text-primary hover:underline"
        >
          전체 보기 →
        </Link>
      </CardFooter>
    </Card>
  )
}

function ThesisItem({ thesis }: { thesis: ActiveThesis }) {
  const personaLabel = getPersonaLabel(thesis.agentPersona)

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ThesisBadge status={thesis.status} />
        <Badge variant="outline">{personaLabel}</Badge>
        <Badge variant="secondary">{thesis.confidence}</Badge>
      </div>
      <p className="text-sm leading-relaxed">{thesis.thesis}</p>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>기간: {thesis.timeframeDays}일</span>
        <span>합의: {thesis.consensusLevel}</span>
        {thesis.category !== '' && <span>{thesis.category}</span>}
      </div>
    </div>
  )
}
