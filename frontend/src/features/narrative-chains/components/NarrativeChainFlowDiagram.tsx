import type { NarrativeChainDetail } from '../types'

interface NarrativeChainFlowDiagramProps {
  chain: NarrativeChainDetail
}

const FLOW_STEPS = [
  { key: 'megatrend', label: 'Megatrend' },
  { key: 'demandDriver', label: 'Demand Driver' },
  { key: 'supplyChain', label: 'Supply Chain' },
  { key: 'bottleneck', label: 'Bottleneck' },
] as const

export function NarrativeChainFlowDiagram({
  chain,
}: NarrativeChainFlowDiagramProps) {
  const values: Record<string, string> = {
    megatrend: chain.megatrend,
    demandDriver: chain.demandDriver,
    supplyChain: chain.supplyChain,
    bottleneck: chain.bottleneck,
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">서사 흐름도</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
        {FLOW_STEPS.map((step, index) => (
          <div key={step.key} className="flex items-center">
            <div className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground">
                {step.label}
              </p>
              <p className="mt-1 text-sm font-semibold">{values[step.key]}</p>
            </div>
            {index < FLOW_STEPS.length - 1 && (
              <span className="hidden px-2 text-muted-foreground sm:inline">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      {chain.nextBottleneck != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">N+1 병목 예측:</span>
          <div className="rounded-lg border border-dashed border-orange-300 bg-orange-50 px-3 py-1.5 dark:border-orange-700 dark:bg-orange-950">
            <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
              {chain.nextBottleneck}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
