export type WatchlistStatus = 'ACTIVE' | 'EXITED'

export interface PhaseTrajectoryPoint {
  date: string
  phase: number
  rsScore: number | null
}

export interface WatchlistStockSummary {
  id: number
  symbol: string
  status: WatchlistStatus
  entryDate: string
  entryPhase: number
  entrySector: string | null
  entrySepaGrade: string | null
  currentPhase: number | null
  sectorRelativePerf: number | null
  pnlPercent: number | null
  daysTracked: number
}

export interface WatchlistStockDetail extends WatchlistStockSummary {
  exitDate: string | null
  exitReason: string | null
  entryRsScore: number | null
  entrySectorRs: number | null
  entryIndustry: string | null
  entryReason: string | null
  entryThesisId: number | null
  trackingEndDate: string | null
  currentRsScore: number | null
  phaseTrajectory: PhaseTrajectoryPoint[] | null
  priceAtEntry: number | null
  currentPrice: number | null
  maxPnlPercent: number | null
  lastUpdated: string | null
}
