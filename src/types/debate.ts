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
 * Full debate result from all 3 rounds.
 */
export interface DebateResult {
  debateDate: string;
  round1: DebateRound;
  round2: DebateRound;
  round3: SynthesisResult;
  metadata: {
    totalTokens: { input: number; output: number };
    totalDurationMs: number;
    agentErrors: Array<{ persona: AgentPersona; round: 1 | 2; error: string }>;
  };
}
