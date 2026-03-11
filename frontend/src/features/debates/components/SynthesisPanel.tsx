import { Card, CardContent } from '@/shared/components/ui/card'
import { MarkdownContent } from '@/shared/components/ui/MarkdownContent'

import type { DebateThesis, MarketRegimeSummary } from '../types'
import { RegimeBadge } from './RegimeBadge'
import { ThesisList } from './ThesisList'

interface SynthesisPanelProps {
  synthesisReport: string
  theses: DebateThesis[]
  regime: MarketRegimeSummary | null
}

export function SynthesisPanel({
  synthesisReport,
  theses,
  regime,
}: SynthesisPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      {regime != null && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">시장 레짐:</span>
          <RegimeBadge regime={regime.regime} confidence={regime.confidence} />
        </div>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold">종합 리포트</h3>
        <Card size="sm">
          <CardContent className="max-h-[600px] overflow-y-auto">
            <MarkdownContent content={synthesisReport} />
          </CardContent>
        </Card>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">
          Thesis 목록 ({theses.length}건)
        </h3>
        <ThesisList theses={theses} />
      </section>
    </div>
  )
}
