import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { MarkdownContent } from '@/shared/components/ui/MarkdownContent'

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
        <MarkdownContent content={output.content} />
      </CardContent>
    </Card>
  )
}
