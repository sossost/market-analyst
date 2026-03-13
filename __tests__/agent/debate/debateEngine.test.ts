import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── SDK Mocks (must come before imports that use them) ───────────────────────

const anthropicCreateMock = vi.fn();
const openaiCreateMock = vi.fn();
const geminiGenerateMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreateMock };
  },
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: { create: openaiCreateMock },
    };
  },
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel() {
      return { generateContent: geminiGenerateMock };
    }
  },
}));

// ─── Set env vars before providers are constructed ───────────────────────────

process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";

import { runDebate } from "../../../src/agent/debate/debateEngine.js";

// ─── Response factories ───────────────────────────────────────────────────────

/**
 * Anthropic SDK 형식의 mock 응답 생성.
 */
function makeAnthropicResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 1000, output_tokens: 500 },
    stop_reason: "end_turn",
  };
}

/**
 * OpenAI SDK 형식의 mock 응답 생성 (GPT-4o, macro).
 */
function makeOpenAIResponse(text: string) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 1000, completion_tokens: 500 },
  };
}

/**
 * Gemini SDK 형식의 mock 응답 생성 (Gemini 2.0 Flash, tech).
 */
function makeGeminiResponse(text: string) {
  return {
    response: {
      text: () => text,
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
    },
  };
}

describe("debateEngine", () => {
  beforeEach(() => {
    anthropicCreateMock.mockReset();
    openaiCreateMock.mockReset();
    geminiGenerateMock.mockReset();
  });

  it("runs full 3-round debate and returns DebateResult", async () => {
    // Round 1 — 4 experts (macro=OpenAI, tech=Gemini, geopolitics=Anthropic, sentiment=Anthropic)
    // Round 2 — 4 crossfire (동일 순서)
    // Round 3 — moderator (Anthropic)

    // macro (GPT-4o)
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro analysis: rates are declining..."))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro rebuttal: tech overestimates..."));

    // tech (Gemini)
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech analysis: AI capex cycle..."))
      .mockResolvedValueOnce(makeGeminiResponse("Tech rebuttal: macro ignores..."));

    // geopolitics, sentiment (Claude), moderator (Claude)
    anthropicCreateMock
      .mockResolvedValueOnce(makeAnthropicResponse("Geopolitics: trade tensions..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Sentiment: fear/greed neutral..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Geopolitics rebuttal: both miss..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Sentiment rebuttal: positioning..."))
      .mockResolvedValueOnce(
        makeAnthropicResponse(`## 종합

합의: AI 사이클 지속

\`\`\`json
[
  {
    "agentPersona": "tech",
    "thesis": "AI capex growth continues above 20% YoY through Q3 2026",
    "timeframeDays": 90,
    "verificationMetric": "Hyperscaler capex growth",
    "targetCondition": "Growth > 20% YoY",
    "invalidationCondition": "Growth < 10% YoY",
    "confidence": "high",
    "consensusLevel": "3/4"
  }
]
\`\`\``),
      );

    const result = await runDebate({
      question: "현재 시장에서 가장 주목해야 할 섹터는?",
      debateDate: "2026-03-05",
      memoryContext: "",
    });

    expect(result.debateDate).toBe("2026-03-05");
    expect(result.round1.round).toBe(1);
    expect(result.round1.outputs).toHaveLength(4);
    expect(result.round2.round).toBe(2);
    expect(result.round2.outputs).toHaveLength(4);
    expect(result.round3.theses).toHaveLength(1);
    expect(result.round3.theses[0].agentPersona).toBe("tech");
    expect(result.metadata.agentErrors).toHaveLength(0);
  });

  it("폴백으로 macro (GPT-4o) 장애를 Claude가 대체하여 토론을 완주한다", async () => {
    // Round 1: OpenAI 실패 → FallbackProvider가 Claude로 폴백하여 macro 정상 참여
    // 따라서 4명 모두 round1, round2 참여, agentErrors = 0
    openaiCreateMock.mockRejectedValueOnce(new Error("API timeout"));

    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech analysis..."))
      .mockResolvedValueOnce(makeGeminiResponse("Tech crossfire..."));

    anthropicCreateMock
      // Round 1: macro fallback + geopolitics + sentiment
      .mockResolvedValueOnce(makeAnthropicResponse("Macro fallback analysis..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Geopolitics analysis..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Sentiment analysis..."))
      // Round 2: macro fallback crossfire + geopolitics crossfire + sentiment crossfire
      .mockResolvedValueOnce(makeAnthropicResponse("Macro fallback crossfire..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Geopolitics crossfire..."))
      .mockResolvedValueOnce(makeAnthropicResponse("Sentiment crossfire..."))
      // Round 3: moderator
      .mockResolvedValueOnce(makeAnthropicResponse("종합...\n\n```json\n[]\n```"));

    const result = await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
    });

    // FallbackProvider가 macro를 Claude로 대체했으므로 4명 모두 참여
    expect(result.round1.outputs).toHaveLength(4);
    expect(result.round2.outputs).toHaveLength(4);
    // OpenAI 실패는 FallbackProvider가 흡수 — agentErrors 없음
    expect(result.metadata.agentErrors).toHaveLength(0);
  });

  it("injects memory context into round 1 system prompts for Claude experts", async () => {
    // 4 round1 + 4 round2 + 1 moderator
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R1"))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R2"));
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech R1"))
      .mockResolvedValueOnce(makeGeminiResponse("Tech R2"));
    for (let i = 0; i < 5; i++) {
      anthropicCreateMock.mockResolvedValueOnce(
        makeAnthropicResponse(i === 4 ? "종합...\n\n```json\n[]\n```" : `Anthropic R${i}`),
      );
    }

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      memoryContext: "원칙 1: RSI 다이버전스는 로테이션 선행 신호",
    });

    // Anthropic 호출에서 Round 1 호출들의 system prompt 확인
    const anthropicCalls = anthropicCreateMock.mock.calls;
    // Round 1에서 Claude experts (geopolitics, sentiment)는 첫 2개 호출
    const r1AnthropicSystemPrompts = anthropicCalls.slice(0, 2).map((c) => c[0].system);
    for (const systemPrompt of r1AnthropicSystemPrompts) {
      expect(systemPrompt).toContain("장기 기억 (검증된 원칙)");
      expect(systemPrompt).toContain("RSI 다이버전스");
    }
  });

  it("injects market data into Round 1 question, not Round 2", async () => {
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R1"))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R2"));
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech R1"))
      .mockResolvedValueOnce(makeGeminiResponse("Tech R2"));
    for (let i = 0; i < 5; i++) {
      anthropicCreateMock.mockResolvedValueOnce(
        makeAnthropicResponse(i === 4 ? "종합...\n\n```json\n[]\n```" : `Anthropic R${i}`),
      );
    }

    const marketData = "## 실제 시장 데이터\nS&P 500: 5,200 (+1.2%)";

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      marketDataContext: marketData,
    });

    // Round 1 Anthropic calls: messages[0].content에 market data 포함
    const r1AnthropicContent = anthropicCreateMock.mock.calls
      .slice(0, 2)
      .map((c) => c[0].messages[0].content);
    for (const content of r1AnthropicContent) {
      expect(content).toContain("실제 시장 데이터");
    }

    // Round 1 OpenAI call: messages[1].content에 market data 포함
    const openaiR1Content = openaiCreateMock.mock.calls[0][0].messages[1].content;
    expect(openaiR1Content).toContain("실제 시장 데이터");

    // Round 2 Anthropic calls: market data 없음 (base question만)
    const r2AnthropicContent = anthropicCreateMock.mock.calls
      .slice(2, 4)
      .map((c) => c[0].messages[0].content);
    for (const content of r2AnthropicContent) {
      expect(content).toContain("Test question");
      expect(content).not.toContain("실제 시장 데이터");
    }
  });
});
