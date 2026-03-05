import { describe, it, expect } from "vitest";
import type { DebateResult, Thesis } from "../../../src/types/debate.js";

// Extract the logic for unit testing (same as in run-debate-agent.ts)
function checkAlertConditions(result: DebateResult): { send: boolean; reason: string } {
  const { theses } = result.round3;

  if (theses.length === 0) {
    return { send: false, reason: "" };
  }

  const highConfidence = theses.filter((t) => t.confidence === "high");
  if (highConfidence.length > 0) {
    return { send: true, reason: `High confidence thesis ${highConfidence.length}개 발견` };
  }

  const lowConsensus = theses.filter(
    (t) => t.consensusLevel === "1/4" || t.consensusLevel === "2/4",
  );
  if (lowConsensus.length > theses.length / 2) {
    return { send: true, reason: `장관 간 의견 분열 (${lowConsensus.length}/${theses.length} low consensus)` };
  }

  if (theses.length >= 3) {
    return { send: true, reason: `활발한 토론 — ${theses.length}개 thesis 도출` };
  }

  return { send: false, reason: "" };
}

function makeResult(theses: Thesis[]): DebateResult {
  return {
    debateDate: "2026-03-05",
    round1: { round: 1, outputs: [] },
    round2: { round: 2, outputs: [] },
    round3: { report: "", theses },
    metadata: { totalTokens: { input: 0, output: 0 }, totalDurationMs: 0, agentErrors: [] },
  };
}

function makeThesis(overrides: Partial<Thesis> = {}): Thesis {
  return {
    agentPersona: "macro",
    thesis: "Test thesis",
    timeframeDays: 30,
    verificationMetric: "metric",
    targetCondition: "condition",
    confidence: "medium",
    consensusLevel: "3/4",
    ...overrides,
  };
}

describe("checkAlertConditions", () => {
  it("does not send when no theses", () => {
    const result = checkAlertConditions(makeResult([]));
    expect(result.send).toBe(false);
  });

  it("sends on high confidence thesis", () => {
    const result = checkAlertConditions(
      makeResult([makeThesis({ confidence: "high" })]),
    );
    expect(result.send).toBe(true);
    expect(result.reason).toContain("High confidence");
  });

  it("sends on low consensus majority", () => {
    const result = checkAlertConditions(
      makeResult([
        makeThesis({ consensusLevel: "2/4" }),
        makeThesis({ consensusLevel: "1/4" }),
        makeThesis({ consensusLevel: "4/4" }),
      ]),
    );
    expect(result.send).toBe(true);
    expect(result.reason).toContain("의견 분열");
  });

  it("sends when 3+ theses generated", () => {
    const result = checkAlertConditions(
      makeResult([makeThesis(), makeThesis(), makeThesis()]),
    );
    expect(result.send).toBe(true);
    expect(result.reason).toContain("3개 thesis");
  });

  it("does not send for 1-2 medium confidence, high consensus theses", () => {
    const result = checkAlertConditions(
      makeResult([
        makeThesis({ confidence: "medium", consensusLevel: "3/4" }),
      ]),
    );
    expect(result.send).toBe(false);
  });

  it("prioritizes high confidence over other conditions", () => {
    const result = checkAlertConditions(
      makeResult([
        makeThesis({ confidence: "high", consensusLevel: "4/4" }),
        makeThesis({ confidence: "low", consensusLevel: "2/4" }),
      ]),
    );
    expect(result.send).toBe(true);
    expect(result.reason).toContain("High confidence");
  });
});
