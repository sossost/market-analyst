import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { extractThesesFromText } from "../round3-synthesis.js";
import { logger } from "@/lib/logger";

// ─── Helper ──────��─────────────────────────────────────────────────────────────

function wrapThesesInText(theses: unknown[]): string {
  return `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;
}

function makeThesis(overrides: Record<string, unknown> = {}) {
  return {
    agentPersona: "macro",
    thesis: "테스트 전망",
    category: "short_term_outlook",
    timeframeDays: 30,
    verificationMetric: "S&P 500",
    targetCondition: "S&P 500 > 5800",
    invalidationCondition: "S&P 500 < 5500",
    confidence: "medium",
    consensusLevel: "3/4",
    ...overrides,
  };
}

// ─── sentiment short_term_outlook 재분류 ─────────────────────────────────────

describe("sentiment short_term_outlook 카테고리 필터", () => {
  it("sentiment의 short_term_outlook을 sector_rotation으로 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        thesis: "VIX 하락 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
    expect(result.theses[0].agentPersona).toBe("sentiment");
  });

  it("sentiment의 structural_narrative는 변경하�� 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        thesis: "포지셔닝 과밀 분석",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("structural_narrative");
  });

  it("sentiment의 sector_rotation은 변경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "자금 로테이션 분석",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });

  it("macro의 short_term_outlook을 sector_rotation으로 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "short_term_outlook",
        thesis: "금리 인하 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });

  it("tech의 short_term_outlook은 ��경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "반도체 수요 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("short_term_outlook");
  });

  it("geopolitics의 short_term_outlook을 sector_rotation으로 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "geopolitics",
        category: "short_term_outlook",
        thesis: "관세 영향 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });

  it("재분류 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        thesis: "VIX 하락 전망",
        timeframeDays: 30,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("sentiment의 thesis 카테고리 재분류"),
    );
  });

  it("여러 thesis 중 macro와 sentiment를 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "short_term_outlook",
        thesis: "매크로 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        thesis: "심리 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(3);
    expect(result.theses.find((t) => t.agentPersona === "macro")!.category).toBe("sector_rotation");
    expect(result.theses.find((t) => t.agentPersona === "sentiment")!.category).toBe("sector_rotation");
    expect(result.theses.find((t) => t.agentPersona === "tech")!.category).toBe("structural_narrative");
  });
});

// ─── sentiment confidence 자동 하향 ─────────────────────────────────────────

describe("sentiment confidence 자동 하향", () => {
  it("sentiment의 high confidence를 medium으로 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        confidence: "high",
        thesis: "포지셔닝 과밀 분석",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("medium");
  });

  it("sentiment의 medium confidence를 low로 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "medium",
        thesis: "자금 로테이션 분석",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("sentiment의 low confidence는 low를 유지한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "low",
        thesis: "약한 확신 분석",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("macro의 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "short_term_outlook",
        confidence: "high",
        thesis: "금리 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("tech의 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        confidence: "high",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("geopolitics의 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "geopolitics",
        category: "structural_narrative",
        confidence: "high",
        thesis: "관세 영향 분석",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("confidence 하향 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        confidence: "high",
        thesis: "포지셔닝 분석",
        timeframeDays: 60,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("sentiment의 thesis confidence 하향"),
    );
  });

  it("여러 thesis에서 sentiment만 confidence 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        confidence: "high",
        thesis: "매크로 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "high",
        thesis: "심리 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        confidence: "high",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(3);
    expect(result.theses.find((t) => t.agentPersona === "macro")!.confidence).toBe("high");
    expect(result.theses.find((t) => t.agentPersona === "sentiment")!.confidence).toBe("medium");
    expect(result.theses.find((t) => t.agentPersona === "tech")!.confidence).toBe("high");
  });
});
