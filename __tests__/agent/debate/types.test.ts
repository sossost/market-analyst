import { describe, it, expect } from "vitest";
import type {
  AgentPersona,
  Thesis,
  AgentLearning,
  DebateResult,
  SynthesisResult,
  PersonaDefinition,
} from "../../../src/types/debate.js";

describe("debate types", () => {
  it("Thesis type accepts valid thesis object", () => {
    const thesis: Thesis = {
      agentPersona: "macro",
      thesis: "Fed will cut rates by 50bp in Q2",
      timeframeDays: 90,
      verificationMetric: "Fed funds rate",
      targetCondition: "Rate cut of 50bp or more",
      invalidationCondition: "Rate hike or no change",
      confidence: "medium",
      consensusLevel: "3/4",
    };

    expect(thesis.agentPersona).toBe("macro");
    expect(thesis.timeframeDays).toBe(90);
  });

  it("AgentLearning type accepts valid learning object", () => {
    const learning: AgentLearning = {
      id: 1,
      principle: "RSI divergence precedes sector rotation by 2 weeks",
      category: "confirmed",
      hitCount: 5,
      missCount: 1,
      hitRate: 0.83,
      sourceThesisIds: [1, 3, 7],
      firstConfirmed: "2026-01-15",
      lastVerified: "2026-03-01",
      expiresAt: "2026-07-15",
      isActive: true,
    };

    expect(learning.category).toBe("confirmed");
    expect(learning.hitRate).toBeCloseTo(0.83);
  });

  it("DebateResult type accepts valid result object", () => {
    const result: DebateResult = {
      debateDate: "2026-03-05",
      round1: {
        round: 1,
        outputs: [{ persona: "macro", content: "Analysis..." }],
      },
      round2: {
        round: 2,
        outputs: [{ persona: "macro", content: "Rebuttal..." }],
      },
      round3: {
        report: "Synthesis report...",
        theses: [],
      },
      marketRegime: null,
      metadata: {
        totalTokens: { input: 10000, output: 5000 },
        totalDurationMs: 30000,
        agentErrors: [],
      },
    };

    expect(result.debateDate).toBe("2026-03-05");
    expect(result.round1.round).toBe(1);
  });
});
