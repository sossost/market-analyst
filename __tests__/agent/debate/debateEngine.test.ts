import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

import { runDebate } from "../../../src/agent/debate/debateEngine.js";

function makeResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 1000, output_tokens: 500 },
    stop_reason: "end_turn",
  };
}

describe("debateEngine", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("runs full 3-round debate and returns DebateResult", async () => {
    // Round 1: 4 expert calls
    // Round 2: 4 crossfire calls
    // Round 3: 1 moderator call
    createMock
      .mockResolvedValueOnce(makeResponse("Macro analysis: rates are declining..."))
      .mockResolvedValueOnce(makeResponse("Tech analysis: AI capex cycle..."))
      .mockResolvedValueOnce(makeResponse("Geopolitics: trade tensions..."))
      .mockResolvedValueOnce(makeResponse("Sentiment: fear/greed neutral..."))
      .mockResolvedValueOnce(makeResponse("Macro rebuttal: tech overestimates..."))
      .mockResolvedValueOnce(makeResponse("Tech rebuttal: macro ignores..."))
      .mockResolvedValueOnce(makeResponse("Geopolitics rebuttal: both miss..."))
      .mockResolvedValueOnce(makeResponse("Sentiment rebuttal: positioning..."))
      .mockResolvedValueOnce(
        makeResponse(`## 종합

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

    expect(result.metadata.totalTokens.input).toBe(9000);
    expect(result.metadata.totalTokens.output).toBe(4500);
    expect(result.metadata.agentErrors).toHaveLength(0);
    expect(createMock).toHaveBeenCalledTimes(9);
  });

  it("continues debate when one agent fails in round 1", async () => {
    createMock
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce(makeResponse("Tech analysis..."))
      .mockResolvedValueOnce(makeResponse("Geopolitics analysis..."))
      .mockResolvedValueOnce(makeResponse("Sentiment analysis..."))
      .mockResolvedValueOnce(makeResponse("Tech crossfire..."))
      .mockResolvedValueOnce(makeResponse("Geopolitics crossfire..."))
      .mockResolvedValueOnce(makeResponse("Sentiment crossfire..."))
      .mockResolvedValueOnce(
        makeResponse("종합...\n\n```json\n[]\n```"),
      );

    const result = await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
    });

    expect(result.round1.outputs).toHaveLength(3);
    expect(result.round2.outputs).toHaveLength(3);
    expect(result.metadata.agentErrors).toHaveLength(1);
    expect(result.metadata.agentErrors[0].persona).toBe("macro");
    expect(result.metadata.agentErrors[0].round).toBe(1);
  });

  it("injects memory context into round 1 system prompts", async () => {
    for (let i = 0; i < 8; i++) {
      createMock.mockResolvedValueOnce(makeResponse(`Response ${i}`));
    }
    createMock.mockResolvedValueOnce(
      makeResponse("종합...\n\n```json\n[]\n```"),
    );

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      memoryContext: "원칙 1: RSI 다이버전스는 로테이션 선행 신호",
    });

    // Round 1 calls are the first 4
    const round1Calls = createMock.mock.calls.slice(0, 4);
    for (const call of round1Calls) {
      const systemPrompt = call[0].system;
      expect(systemPrompt).toContain("장기 기억 (검증된 원칙)");
      expect(systemPrompt).toContain("RSI 다이버전스");
    }
  });

  it("injects market data into Round 1 only, not Round 2/3", async () => {
    for (let i = 0; i < 8; i++) {
      createMock.mockResolvedValueOnce(makeResponse(`Response ${i}`));
    }
    createMock.mockResolvedValueOnce(
      makeResponse("종합...\n\n```json\n[]\n```"),
    );

    const marketData = "## 실제 시장 데이터\nS&P 500: 5,200 (+1.2%)";

    await runDebate({
      question: "Test question",
      debateDate: "2026-03-05",
      marketDataContext: marketData,
    });

    // Round 1 (first 4 calls): should have market data
    const round1Calls = createMock.mock.calls.slice(0, 4);
    for (const call of round1Calls) {
      const content = call[0].messages[0].content;
      expect(content).toContain("실제 시장 데이터");
    }

    // Round 2 (next 4 calls): base question only, market data via Round 1 outputs
    const round2Calls = createMock.mock.calls.slice(4, 8);
    for (const call of round2Calls) {
      const content = call[0].messages[0].content;
      expect(content).toContain("Test question");
      expect(content).not.toContain("실제 시장 데이터");
    }

    // Round 3 (last call): has market data re-injected for cross-validation
    const round3Content = createMock.mock.calls[8][0].messages[0].content;
    expect(round3Content).toContain("Test question");
    expect(round3Content).toContain("실제 시장 데이터");
  });
});
