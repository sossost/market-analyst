export type LearningCategory = 'confirmed' | 'caution'

export type VerificationPath = 'quantitative' | 'llm' | 'mixed'

export interface AgentLearning {
  id: number
  principle: string
  category: LearningCategory
  hitCount: number
  missCount: number
  hitRate: number | null
  isActive: boolean
  verificationPath: VerificationPath | null
  firstConfirmed: string | null
  lastVerified: string | null
  expiresAt: string | null
  createdAt: string
}

export interface LearningSummary {
  activePrincipleCount: number
  averageHitRate: number | null
  lastVerifiedDate: string | null
}
