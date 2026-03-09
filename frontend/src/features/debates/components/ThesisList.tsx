import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Badge } from '@/shared/components/ui/badge'

import type { DebateThesis } from '../types'
import { ThesisBadge } from './ThesisBadge'

const PERSONA_LABELS: Record<string, string> = {
  macro: '거시경제',
  tech: '기술분석',
  geopolitics: '지정학',
  sentiment: '심리분석',
}

interface ThesisListProps {
  theses: DebateThesis[]
}

export function ThesisList({ theses }: ThesisListProps) {
  if (theses.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        생성된 thesis가 없습니다
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {theses.map((thesis) => (
        <ThesisCard key={thesis.id} thesis={thesis} />
      ))}
    </div>
  )
}

function ThesisCard({ thesis }: { thesis: DebateThesis }) {
  const personaLabel = PERSONA_LABELS[thesis.agentPersona] ?? thesis.agentPersona

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ThesisBadge status={thesis.status} />
          <Badge variant="outline">{personaLabel}</Badge>
          <Badge variant="ghost">{thesis.category}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm leading-relaxed">{thesis.thesis}</p>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>기간: {thesis.timeframeDays}일</span>
          <span>신뢰도: {thesis.confidence}</span>
          <span>합의: {thesis.consensusLevel}</span>
        </div>

        {thesis.nextBottleneck != null && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">다음 병목:</span>{' '}
            {thesis.nextBottleneck}
          </p>
        )}

        {thesis.dissentReason != null && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">반대 의견:</span>{' '}
            {thesis.dissentReason}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
