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

// ─── Mock child_process for ClaudeCliProvider (sonnet model → claude CLI) ─────

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

// ─── Set env vars before providers are constructed ───────────────────────────

process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";

import { runDebate } from "@/debate/debateEngine.js";

// ─── Response factories ───────────────────────────────────────────────────────

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
 * Gemini SDK 형식의 mock 응답 생성 (Gemini 2.5 Flash, tech).
 */
function makeGeminiResponse(text: string) {
  return {
    response: {
      text: () => text,
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
    },
  };
}

/**
 * Claude CLI의 JSON 출력 형식을 시뮬레이션.
 * execFile callback을 통해 stdout으로 전달된다.
 */
function makeCliJsonOutput(text: string): string {
  return JSON.stringify({
    type: "result",
    result: text,
    usage: { input_tokens: 1000, output_tokens: 500 },
  });
}

/**
 * execFile mock을 Claude CLI 호출에 대응하도록 설정.
 * 호출 순서에 따라 순차적으로 응답을 반환한다.
 */
function setupClaudeCliMock(responses: string[]) {
  let callIndex = 0;

  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
      const response = responses[callIndex] ?? makeCliJsonOutput("fallback response");
      callIndex++;

      // stdin을 시뮬레이션하기 위한 mock child process
      const child = {
        stdin: {
          end: vi.fn(),
        },
      };

      // 비동기로 callback 호출 (실제 execFile 동작 시뮬레이션)
      process.nextTick(() => {
        callback(null, response, "");
      });

      return child;
    },
  );
}

describe("debateEngine", () => {
  beforeEach(() => {
    anthropicCreateMock.mockReset();
    openaiCreateMock.mockReset();
    geminiGenerateMock.mockReset();
    execFileMock.mockReset();
  });

  it("runs full 3-round debate and returns DebateResult", async () => {
    // Provider mapping:
    //   macro (gpt-4o) → OpenAI + Claude fallback
    //   tech (gemini-2.5-flash) → Gemini + Claude fallback
    //   geopolitics (sonnet) → ClaudeCliProvider (execFile)
    //   sentiment (sonnet) → ClaudeCliProvider (execFile)
    //   moderator (sonnet) → ClaudeCliProvider (execFile)

    // macro (GPT-4o) — Round 1 + Round 2
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro analysis: rates are declining..."))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro rebuttal: tech overestimates..."));

    // tech (Gemini) — Round 1 + Round 2
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech analysis: AI capex cycle..."))
      .mockResolvedValueOnce(makeGeminiResponse("Tech rebuttal: macro ignores..."));

    // geopolitics (CLI) R1, sentiment (CLI) R1,
    // geopolitics (CLI) R2, sentiment (CLI) R2,
    // moderator (CLI) R3
    setupClaudeCliMock([
      makeCliJsonOutput("Geopolitics: trade tensions..."),
      makeCliJsonOutput("Sentiment: fear/greed neutral..."),
      makeCliJsonOutput("Geopolitics rebuttal: both miss..."),
      makeCliJsonOutput("Sentiment rebuttal: positioning..."),
      makeCliJsonOutput(`## 종합

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
    ]);

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

  it("폴백으로 macro (GPT-4o) 장애를 Claude CLI가 대체하여 토론을 완주한다", async () => {
    // OpenAI 실패 → FallbackProvider가 Claude CLI로 폴백
    openaiCreateMock.mockRejectedValueOnce(new Error("API timeout"));

    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech analysis..."))
      .mockResolvedValueOnce(makeGeminiResponse("Tech crossfire..."));

    // CLI calls:
    // macro fallback R1, geopolitics R1, sentiment R1,
    // macro fallback R2 (OpenAI retry might fail again, or FallbackProvider caches)
    // ... geopolitics R2, sentiment R2, moderator R3
    // Note: FallbackProvider for macro Round 2 also needs OpenAI to fail
    openaiCreateMock.mockRejectedValueOnce(new Error("API timeout"));

    setupClaudeCliMock([
      makeCliJsonOutput("Macro fallback analysis..."),
      makeCliJsonOutput("Geopolitics analysis..."),
      makeCliJsonOutput("Sentiment analysis..."),
      makeCliJsonOutput("Macro fallback crossfire..."),
      makeCliJsonOutput("Geopolitics crossfire..."),
      makeCliJsonOutput("Sentiment crossfire..."),
      makeCliJsonOutput("종합...\n\n```json\n[]\n```"),
    ]);

    const result = await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
    });

    // FallbackProvider가 macro를 Claude CLI로 대체했으므로 4명 모두 참여
    expect(result.round1.outputs).toHaveLength(4);
    expect(result.round2.outputs).toHaveLength(4);
    // OpenAI 실패는 FallbackProvider가 흡수 — agentErrors 없음
    expect(result.metadata.agentErrors).toHaveLength(0);
  });

  it("injects memory context into round 1 system prompts for Claude experts", async () => {
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R1"))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R2"));
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech R1"))
      .mockResolvedValueOnce(makeGeminiResponse("Tech R2"));

    setupClaudeCliMock([
      makeCliJsonOutput("Geopolitics R1"),
      makeCliJsonOutput("Sentiment R1"),
      makeCliJsonOutput("Geopolitics R2"),
      makeCliJsonOutput("Sentiment R2"),
      makeCliJsonOutput("종합...\n\n```json\n[]\n```"),
    ]);

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      memoryContext: "원칙 1: RSI 다이버전스는 로테이션 선행 신호",
    });

    // Claude CLI 호출의 --system-prompt 인수에서 memory context 확인
    // execFile(cmd, args, opts, callback) — args[3]이 --system-prompt, args[4]가 값
    const cliCalls = execFileMock.mock.calls;
    // Round 1의 Claude experts는 처음 2개 CLI 호출 (geopolitics, sentiment)
    const r1SystemPrompts = cliCalls.slice(0, 2).map((call: unknown[]) => {
      const args = call[1] as string[];
      const systemPromptIdx = args.indexOf("--system-prompt");
      return systemPromptIdx >= 0 ? args[systemPromptIdx + 1] : "";
    });

    for (const systemPrompt of r1SystemPrompts) {
      expect(systemPrompt).toContain("장기 기억 (검증된 원칙)");
      expect(systemPrompt).toContain("RSI 다이버전스");
    }
  });

  it("injects market data into Round 1 question and Round 2 via market-data tag", async () => {
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R1"))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R2"));
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech R1"))
      .mockResolvedValueOnce(makeGeminiResponse("Tech R2"));

    setupClaudeCliMock([
      makeCliJsonOutput("Geopolitics R1"),
      makeCliJsonOutput("Sentiment R1"),
      makeCliJsonOutput("Geopolitics R2"),
      makeCliJsonOutput("Sentiment R2"),
      makeCliJsonOutput("종합...\n\n```json\n[]\n```"),
    ]);

    const marketData = "## 실제 시장 데이터\nS&P 500: 5,200 (+1.2%)";

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      marketDataContext: marketData,
    });

    // Round 1 OpenAI call: messages[1].content에 market data가 question에 직접 포함
    const openaiR1Content = openaiCreateMock.mock.calls[0][0].messages[1].content;
    expect(openaiR1Content).toContain("실제 시장 데이터");

    // Round 2 OpenAI call: market data는 <market-data> 태그로 별도 주입 (#936)
    const openaiR2Content = openaiCreateMock.mock.calls[1][0].messages[1].content;
    expect(openaiR2Content).toContain("Test question");
    expect(openaiR2Content).toContain("<market-data>");
    expect(openaiR2Content).toContain("S&P 500: 5,200");
  });

  it("merges per-persona newsContext and injects into Round 2 via news-context tag", async () => {
    openaiCreateMock
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R1"))
      .mockResolvedValueOnce(makeOpenAIResponse("Macro R2"));
    geminiGenerateMock
      .mockResolvedValueOnce(makeGeminiResponse("Tech R1"))
      .mockResolvedValueOnce(makeGeminiResponse("Tech R2"));

    setupClaudeCliMock([
      makeCliJsonOutput("Geopolitics R1"),
      makeCliJsonOutput("Sentiment R1"),
      makeCliJsonOutput("Geopolitics R2"),
      makeCliJsonOutput("Sentiment R2"),
      makeCliJsonOutput("종합...\n\n```json\n[]\n```"),
    ]);

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      newsContext: {
        macro: "Fed 금리 동결 전망",
        tech: "NVIDIA 실적 서프라이즈",
        geopolitics: "",
        sentiment: "",
      },
    });

    // Round 2 OpenAI call: 합산된 뉴스가 <news-context> 태그로 주입
    const openaiR2Content = openaiCreateMock.mock.calls[1][0].messages[1].content;
    expect(openaiR2Content).toContain("<news-context>");
    expect(openaiR2Content).toContain("Fed 금리 동결 전망");
    expect(openaiR2Content).toContain("NVIDIA 실적 서프라이즈");
    // 빈 뉴스는 필터링됨 — news-context 블록 내에 뉴스가 있는 persona만 포함
    const newsBlock = openaiR2Content.split("<news-context>")[1]?.split("</news-context>")[0] ?? "";
    expect(newsBlock).toContain("### macro");
    expect(newsBlock).toContain("### tech");
    expect(newsBlock).not.toContain("### geopolitics");
    expect(newsBlock).not.toContain("### sentiment");
  });
});
