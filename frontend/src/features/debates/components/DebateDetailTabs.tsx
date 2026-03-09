'use client'

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/shared/components/ui/tabs'

import type { RoundOutput, DebateThesis, MarketRegimeSummary } from '../types'
import { RoundPanel } from './RoundPanel'
import { SynthesisPanel } from './SynthesisPanel'

interface DebateDetailTabsProps {
  round1Outputs: RoundOutput[] | null
  round2Outputs: RoundOutput[] | null
  synthesisReport: string
  theses: DebateThesis[]
  regime: MarketRegimeSummary | null
}

export function DebateDetailTabs({
  round1Outputs,
  round2Outputs,
  synthesisReport,
  theses,
  regime,
}: DebateDetailTabsProps) {
  const isRound1Disabled = round1Outputs == null
  const isRound2Disabled = round2Outputs == null

  return (
    <Tabs defaultValue={2}>
      <TabsList className="w-full overflow-x-auto sm:w-auto">
        <TabsTrigger
          value={0}
          disabled={isRound1Disabled}
          aria-disabled={isRound1Disabled}
        >
          Round 1
        </TabsTrigger>
        <TabsTrigger
          value={1}
          disabled={isRound2Disabled}
          aria-disabled={isRound2Disabled}
        >
          Round 2
        </TabsTrigger>
        <TabsTrigger value={2}>종합</TabsTrigger>
      </TabsList>

      <TabsContent value={0} className="mt-4">
        <RoundPanel outputs={round1Outputs} />
      </TabsContent>

      <TabsContent value={1} className="mt-4">
        <RoundPanel outputs={round2Outputs} />
      </TabsContent>

      <TabsContent value={2} className="mt-4">
        <SynthesisPanel
          synthesisReport={synthesisReport}
          theses={theses}
          regime={regime}
        />
      </TabsContent>
    </Tabs>
  )
}
