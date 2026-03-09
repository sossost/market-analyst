import type { RoundOutput } from '../types'
import { AnalystCard } from './AnalystCard'

interface RoundPanelProps {
  outputs: RoundOutput[] | null
}

export function RoundPanel({ outputs }: RoundPanelProps) {
  if (outputs == null) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        라운드 데이터가 없습니다
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {outputs.map((output) => (
        <AnalystCard key={output.persona} output={output} />
      ))}
    </div>
  )
}
