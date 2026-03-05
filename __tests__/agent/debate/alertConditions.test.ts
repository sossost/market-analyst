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
    return { send: true, reason: `확신도 높은 전망 ${highConfidence.length}건` };
  }

  const lowConsensus = theses.filter(
    (t) => t.consensusLevel === "1/4" || t.consensusLevel === "2/4",
  );
  if (lowConsensus.length > theses.length / 2) {
    return { send: true, reason: `분석가 간 의견 분열 — 주의 필요` };
  }

  if (theses.length >= 3) {
    return { send: true, reason: `주요 전망 ${theses.length}건 도출` };
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
    expect(result.reason).toContain("확신도 높은 전망");
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
    expect(result.reason).toContain("주요 전망 3건");
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
    expect(result.reason).toContain("확신도 높은 전망");
  });
});

// Same logic as run-debate-agent.ts extractCoreInsight
function extractCoreInsight(report: string): string {
  const match = report.match(/##\s*1\.\s*핵심 요약[^\n]*\n([\s\S]*?)(?=\n##\s*2\.|\n##\s*\d)/);
  if (match != null) {
    return match[1].trim();
  }
  const firstChunk = report.slice(0, 300).trim();
  return firstChunk.endsWith(".") ? firstChunk : `${firstChunk}...`;
}

describe("extractCoreInsight", () => {
  it("extracts core insight section from report", () => {
    const report = `# 시장 브리핑

## 1. 핵심 요약

**구조적 변화:** 실물 중심 패러다임 전환
**주목 섹터:** Energy(XLE), Basic Materials(XLB)
**리스크:** VIX 급등

## 2. 시장 환경 판단

지수 데이터...`;

    const result = extractCoreInsight(report);
    expect(result).toContain("구조적 변화");
    expect(result).toContain("Energy(XLE)");
    expect(result).not.toContain("시장 환경 판단");
  });

  it("falls back to first 300 chars when no section found", () => {
    const report = "짧은 리포트 내용입니다.";
    const result = extractCoreInsight(report);
    expect(result).toContain("짧은 리포트");
  });
});
