import type { DebateThesis, MarketRegimeSummary } from '@/features/debates/types'

export interface DashboardReport {
  id: number
  reportDate: string
  phase2Ratio: number
  leadingSectors: string[]
  totalAnalyzed: number
  symbolCount: number
}

export type ActiveThesis = DebateThesis

export interface RecommendationSummary {
  id: number
  symbol: string
  sector: string | null
  pnlPercent: number | null
  maxPnlPercent: number | null
  daysHeld: number
  currentPhase: number | null
}

export interface RecommendationStats {
  activeCount: number
  winRate: number
  avgPnlPercent: number
  avgDaysHeld: number
  topItems: RecommendationSummary[]
}

export interface RecentRegime {
  regimeDate: string
  regime: MarketRegimeSummary['regime']
  rationale: string
  confidence: MarketRegimeSummary['confidence']
}
