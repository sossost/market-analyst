import { describe, it, expect } from "vitest";
import type { DebateResult, Thesis } from "../../../src/types/debate.js";
import type { MarketSnapshot } from "../../../src/agent/debate/marketDataLoader.js";
import { sanitizeErrorForDiscord } from "@/agent/discord";

// Minimal snapshot type for testing (matches MarketSnapshot shape)
interface SectorSnapshot {
  sector: string;
  avgRs: number;
  rsRank: number;
  groupPhase: number;
  prevGroupPhase: number | null;
  change4w: number | null;
  change12w: number | null;
  phase2Ratio: number | null;
  phase1to2Count5d: number;
}

// Extract the logic for unit testing (same as in run-debate-agent.ts)
function checkAlertConditions(
  result: DebateResult,
  snapshot: MarketSnapshot,
): { send: boolean; reason: string } {
  const { theses } = result.round3;

  if (theses.length === 0) {
    return { send: false, reason: "" };
  }

  const highConfidence = theses.filter((t) => t.confidence === "high");

  // 조건 1: high confidence 2개 이상
  if (highConfidence.length >= 2) {
    return { send: true, reason: `확신도 높은 전망 ${highConfidence.length}건` };
  }

  // 조건 2: 의견 분열 과반
  const lowConsensus = theses.filter(
    (t) => t.consensusLevel === "1/4" || t.consensusLevel === "2/4",
  );
  if (lowConsensus.length > theses.length / 2) {
    return { send: true, reason: `애널리스트 간 의견 분열 — 주의 필요` };
  }

  // 조건 3: 섹터 Phase 전환 + high confidence
  const hasPhaseTransition = snapshot.sectors.some(
    (s) => s.groupPhase === 2 && s.prevGroupPhase === 1,
  );
  if (hasPhaseTransition && highConfidence.length >= 1) {
    return { send: true, reason: `섹터 Phase 전환 + 확신도 높은 전망 감지` };
  }

  return { send: false, reason: "" };
}

function makeSnapshot(sectors: SectorSnapshot[] = []): MarketSnapshot {
  return {
    date: "2026-03-05",
    sectors,
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: null,
    indices: [],
    fearGreed: null,
  };
}

function makeSector(overrides: Partial<SectorSnapshot> = {}): SectorSnapshot {
  return {
    sector: "Technology",
    avgRs: 60,
    rsRank: 1,
    groupPhase: 2,
    prevGroupPhase: 2,
    change4w: 5,
    change12w: 10,
    phase2Ratio: 0.4,
    phase1to2Count5d: 3,
    ...overrides,
  };
}

function makeResult(theses: Thesis[]): DebateResult {
  return {
    debateDate: "2026-03-05",
    round1: { round: 1, outputs: [] },
    round2: { round: 2, outputs: [] },
    round3: { report: "", theses },
    marketRegime: null,
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

const NO_TRANSITION_SNAPSHOT = makeSnapshot([makeSector({ groupPhase: 2, prevGroupPhase: 2 })]);
const PHASE_TRANSITION_SNAPSHOT = makeSnapshot([makeSector({ groupPhase: 2, prevGroupPhase: 1 })]);

describe("checkAlertConditions", () => {
  it("does not send when no theses", () => {
    const result = checkAlertConditions(makeResult([]), NO_TRANSITION_SNAPSHOT);
    expect(result.send).toBe(false);
  });

  it("does not send for single high confidence thesis without phase transition", () => {
    const result = checkAlertConditions(
      makeResult([makeThesis({ confidence: "high" })]),
      NO_TRANSITION_SNAPSHOT,
    );
    expect(result.send).toBe(false);
  });

  it("sends on 2+ high confidence theses", () => {
    const result = checkAlertConditions(
      makeResult([
        makeThesis({ confidence: "high" }),
        makeThesis({ confidence: "high" }),
      ]),
      NO_TRANSITION_SNAPSHOT,
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
      NO_TRANSITION_SNAPSHOT,
    );
    expect(result.send).toBe(true);
    expect(result.reason).toContain("의견 분열");
  });

  it("does NOT send when 3+ medium theses (old condition 3 removed)", () => {
    const result = checkAlertConditions(
      makeResult([makeThesis(), makeThesis(), makeThesis()]),
      NO_TRANSITION_SNAPSHOT,
    );
    expect(result.send).toBe(false);
  });

  it("does not send for 1-2 medium confidence, high consensus theses", () => {
    const result = checkAlertConditions(
      makeResult([
        makeThesis({ confidence: "medium", consensusLevel: "3/4" }),
      ]),
      NO_TRANSITION_SNAPSHOT,
    );
    expect(result.send).toBe(false);
  });

  it("sends on phase transition + single high confidence thesis", () => {
    const result = checkAlertConditions(
      makeResult([makeThesis({ confidence: "high" })]),
      PHASE_TRANSITION_SNAPSHOT,
    );
    expect(result.send).toBe(true);
    expect(result.reason).toContain("Phase 전환");
  });

  it("does not send on phase transition without high confidence", () => {
    const result = checkAlertConditions(
      makeResult([makeThesis({ confidence: "medium" })]),
      PHASE_TRANSITION_SNAPSHOT,
    );
    expect(result.send).toBe(false);
  });

  it("prioritizes 2+ high confidence over phase transition condition", () => {
    const result = checkAlertConditions(
      makeResult([
        makeThesis({ confidence: "high", consensusLevel: "4/4" }),
        makeThesis({ confidence: "high", consensusLevel: "3/4" }),
      ]),
      PHASE_TRANSITION_SNAPSHOT,
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

function sanitizeDiscordMentions(text: string): string {
  return text
    .replace(/@everyone/gi, "@\u200Beveryone")
    .replace(/@here/gi, "@\u200Bhere")
    .replace(/<@[!&]?\d+>/g, "[mention]");
}

describe("sanitizeDiscordMentions", () => {
  it("neutralizes @everyone and @here", () => {
    const result = sanitizeDiscordMentions("Alert @everyone check @here now");
    expect(result).not.toContain("@everyone");
    expect(result).not.toContain("@here");
    expect(result).toContain("@\u200Beveryone");
  });

  it("removes user/role mentions", () => {
    const result = sanitizeDiscordMentions("Thanks <@123456> and <@&789>");
    expect(result).toBe("Thanks [mention] and [mention]");
  });

  it("leaves normal text unchanged", () => {
    const text = "S&P 500 up 1.2% today";
    expect(sanitizeDiscordMentions(text)).toBe(text);
  });
});

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

describe("sanitizeErrorForDiscord", () => {
  it("redacts postgres connection strings", () => {
    const msg = "Connection failed: postgresql://user:pass@host:5432/db";
    const result = sanitizeErrorForDiscord(msg);
    expect(result).toContain("[DB_URL]");
    expect(result).not.toContain("user:pass");
  });

  it("redacts URLs containing token", () => {
    const msg = "Failed: https://api.example.com/token=abc123";
    const result = sanitizeErrorForDiscord(msg);
    expect(result).toContain("[REDACTED_URL]");
    expect(result).not.toContain("abc123");
  });

  it("truncates long error messages", () => {
    const msg = "x".repeat(1000);
    const result = sanitizeErrorForDiscord(msg);
    expect(result.length).toBeLessThanOrEqual(503); // 500 + "..."
  });

  it("leaves normal errors unchanged", () => {
    const msg = "Round 1 failed: no agents produced output";
    expect(sanitizeErrorForDiscord(msg)).toBe(msg);
  });

  it("redacts webhook URLs", () => {
    const msg = "Failed: https://discord.com/api/webhooks/123/abc";
    const result = sanitizeErrorForDiscord(msg);
    expect(result).toContain("[REDACTED_URL]");
    expect(result).not.toContain("webhooks/123");
  });

  it("redacts API keys with sk- prefix", () => {
    const msg = "Auth failed with key sk-ant-api03-abc123";
    const result = sanitizeErrorForDiscord(msg);
    expect(result).toContain("[REDACTED_KEY]");
    expect(result).not.toContain("sk-ant-api03-abc123");
  });
});
