/**
 * Debate system types.
 */

export type AgentPersona = "macro" | "tech" | "geopolitics" | "sentiment";
export type ModeratorRole = "moderator";
export type DebateRole = AgentPersona | ModeratorRole;

export type ThesisStatus = "ACTIVE" | "CONFIRMED" | "INVALIDATED" | "EXPIRED";
export type Confidence = "low" | "medium" | "high";
export type ConsensusLevel = "4/4" | "3/4" | "2/4" | "1/4";
export type TimeframeDays = 30 | 60 | 90;
export type LearningCategory = "confirmed" | "caution";
export type ThesisCategory =
  | "structural_narrative"
  | "sector_rotation"
  | "short_term_outlook";

/**
 * Persona definition loaded from .claude/agents/*.md
 */
export interface PersonaDefinition {
  name: DebateRole;
  description: string;
  model: string;
  systemPrompt: string;
}

/**
 * 소수 의견 — 다수와 다른 입장을 취한 애널리스트의 견해.
 * 사후 검증으로 소수가 맞았는지 추적한다.
 */
export type MinorityViewPosition = "bearish" | "bullish" | "neutral";

export interface MinorityView {
  analyst: AgentPersona;
  position: MinorityViewPosition;
  reasoning: string;
  wasCorrect: boolean | null; // 사후 검증 시 업데이트
}

/**
 * Structured narrative chain fields extracted from a structural_narrative thesis.
 * Populated by the LLM in round 3 synthesis.
 */
export interface NarrativeChainFields {
  megatrend: string;
  demandDriver: string;
  supplyChain: string;
  bottleneck: string;
}

/**
 * Single thesis extracted from moderator synthesis.
 */
export interface Thesis {
  agentPersona: AgentPersona;
  thesis: string;
  timeframeDays: TimeframeDays;
  verificationMetric: string;
  targetCondition: string;
  invalidationCondition?: string;
  confidence: Confidence;
  consensusLevel: ConsensusLevel;
  category?: ThesisCategory;
  nextBottleneck?: string | null;
  dissentReason?: string | null;
  beneficiarySectors?: string[] | null;
  beneficiaryTickers?: string[] | null;
  nextBeneficiarySectors?: string[] | null;
  nextBeneficiaryTickers?: string[] | null;
  narrativeChain?: NarrativeChainFields | null;
  minorityView?: MinorityView | null;
}

/**
 * Agent learning (long-term memory principle).
 */
export interface AgentLearning {
  id: number;
  principle: string;
  category: LearningCategory;
  hitCount: number;
  missCount: number;
  hitRate: number | null;
  sourceThesisIds: number[];
  firstConfirmed: string | null;
  lastVerified: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

/**
 * Single agent's output for a debate round.
 */
export interface RoundOutput {
  persona: AgentPersona;
  content: string;
}

/**
 * Complete debate round results.
 */
export interface DebateRound {
  round: 1 | 2 | 3;
  outputs: RoundOutput[];
}

/**
 * Moderator synthesis result (round 3).
 */
export interface SynthesisResult {
  report: string;
  theses: Thesis[];
}

/**
 * Consensus score별 적중률 집계 row.
 */
export interface ConsensusHitRateRow {
  consensusScore: number;
  confirmed: number;
  invalidated: number;
  expired: number;
  total: number;
}

/**
 * Raw market regime data extracted from moderator output.
 */
export interface MarketRegimeRaw {
  regime: string;
  rationale: string;
  confidence: string;
}

/**
 * Full debate result from all 3 rounds.
 */
export interface DebateResult {
  debateDate: string;
  round1: DebateRound;
  round2: DebateRound;
  round3: SynthesisResult;
  marketRegime: MarketRegimeRaw | null;
  metadata: {
    totalTokens: { input: number; output: number };
    totalDurationMs: number;
    agentErrors: Array<{ persona: AgentPersona; round: 1 | 2; error: string }>;
  };
}
