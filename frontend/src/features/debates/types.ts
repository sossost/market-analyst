export type DebateRound = 'round1' | 'round2' | 'synthesis'

export interface DebateSession {
  id: number
  debateDate: string
}

export interface RoundOutput {
  persona: 'macro' | 'tech' | 'geopolitics' | 'sentiment'
  content: string
}

export interface DebateSessionSummary {
  id: number
  date: string
  vix: string | null
  fearGreedScore: string | null
  phase2Ratio: string | null
  topSectorRs: string | null
  thesesCount: number
}

export interface DebateSessionDetail extends DebateSessionSummary {
  round1Outputs: string
  round2Outputs: string
  synthesisReport: string
  marketSnapshot: string
  tokensInput: number | null
  tokensOutput: number | null
  durationMs: number | null
}

export interface DebateThesis {
  id: number
  agentPersona: string
  thesis: string
  timeframeDays: number
  confidence: 'low' | 'medium' | 'high'
  consensusLevel: string
  category: string
  status: 'ACTIVE' | 'CONFIRMED' | 'INVALIDATED' | 'EXPIRED'
  nextBottleneck: string | null
  dissentReason: string | null
}

export interface MarketRegimeSummary {
  regime: 'EARLY_BULL' | 'MID_BULL' | 'LATE_BULL' | 'EARLY_BEAR' | 'BEAR'
  rationale: string
  confidence: 'low' | 'medium' | 'high'
}
