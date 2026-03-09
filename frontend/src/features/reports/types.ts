export type ReportType = 'daily' | 'weekly'

export interface ReportedStock {
  symbol: string
  phase: number
  prevPhase: number | null
  rsScore: number
  sector: string
  industry: string
  reason: string
  firstReportedDate: string
}

export interface MarketSummary {
  phase2Ratio: number
  leadingSectors: string[]
  totalAnalyzed: number
}

export interface ReportMetadata {
  model: string
  tokensUsed: { input: number; output: number }
  toolCalls: number
  executionTime: number
}

export interface ReportSummary {
  id: number
  reportDate: string
  type: ReportType
  symbolCount: number
  leadingSectors: string[]
  phase2Ratio: number
}

export interface ReportDetail {
  id: number
  reportDate: string
  type: ReportType
  reportedSymbols: ReportedStock[]
  marketSummary: MarketSummary
  fullContent: string | null
  metadata: ReportMetadata
}
