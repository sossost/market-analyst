export type NarrativeChainStatus =
  | 'ACTIVE'
  | 'RESOLVING'
  | 'RESOLVED'
  | 'OVERSUPPLY'
  | 'INVALIDATED'

export interface NarrativeChainSummary {
  id: number
  megatrend: string
  demandDriver: string
  supplyChain: string
  bottleneck: string
  bottleneckIdentifiedAt: string
  nextBottleneck: string | null
  status: NarrativeChainStatus
  beneficiarySectors: string[]
  beneficiaryTickers: string[]
  linkedThesisCount: number
  alphaCompatible: boolean | null
}

export interface NarrativeChainDetail extends NarrativeChainSummary {
  bottleneckResolvedAt: string | null
  linkedThesisIds: number[]
  resolutionDays: number | null
}
