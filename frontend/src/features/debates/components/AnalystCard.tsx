import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import { PERSONA_LABELS } from '../constants'
import type { RoundOutput } from '../types'

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
