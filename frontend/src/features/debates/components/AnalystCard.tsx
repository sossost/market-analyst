import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { RoundOutput } from '../types'

const PERSONA_LABELS: Record<RoundOutput['persona'], string> = {
  macro: '거시경제',
  tech: '기술분석',
  geopolitics: '지정학',
  sentiment: '심리분석',
}

interface AnalystCardProps {
  output: RoundOutput
}

export function AnalystCard({ output }: AnalystCardProps) {
  const label = PERSONA_LABELS[output.persona] ?? output.persona

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {output.content}
        </p>
      </CardContent>
    </Card>
  )
}
