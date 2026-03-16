export type RecommendationStatus = 'ACTIVE' | 'CLOSED' | 'STOPPED'

export interface RecommendationSummary {
  id: number
  symbol: string
  recommendationDate: string
  entryPrice: number
  entryPhase: number
  entryPrevPhase: number | null
  entryRsScore: number | null
  currentPrice: number | null
  currentPhase: number | null
  pnlPercent: number | null
  maxPnlPercent: number | null
  daysHeld: number
  status: RecommendationStatus
  closeDate: string | null
  sector: string | null
  marketRegime: string | null
}

export interface RecommendationDetail extends RecommendationSummary {
  industry: string | null
  currentRsScore: number | null
  closePrice: number | null
  closeReason: string | null
  lastUpdated: string | null
  reason: string | null
}
