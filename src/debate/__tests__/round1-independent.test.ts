import { describe, it, expect, vi } from "vitest";
import { runRound1 } from "../round1-independent.js";
import type { PersonaDefinition } from "@/types/debate";
import type { LLMProvider } from "../llm/index.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeMockProvider(content = "mock analysis"): LLMProvider {
  return {
    call: vi.fn().mockResolvedValue({
      content,
      tokensUsed: { input: 100, output: 50 },
    }),
  };
}

function makeExpert(name: string): PersonaDefinition {
  return {
    name: name as PersonaDefinition["name"],
    description: `${name} expert`,
    model: "test-model",
    systemPrompt: `You are a ${name} analyst.`,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runRound1", () => {
  it("fundamentalContext가 없으면 userMessage에 fundamental-data 태그가 포함되지 않는다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];

    await runRound1({
      getProvider,
      experts,
      question: "시장 분석",
      memoryContext: "",
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.userMessage).not.toContain("<fundamental-data>");
    expect(callArgs.userMessage).not.toContain("</fundamental-data>");
  });

  it("빈 fundamentalContext면 userMessage에 fundamental-data 태그가 포함되지 않는다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];

    await runRound1({
      getProvider,
      experts,
      question: "시장 분석",
      memoryContext: "",
      fundamentalContext: "",
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.userMessage).not.toContain("<fundamental-data>");
  });

  it("fundamentalContext가 있으면 모든 전문가의 userMessage에 주입된다", async () => {
    const providers: LLMProvider[] = [];
    const getProvider = vi.fn().mockImplementation(() => {
      const p = makeMockProvider();
      providers.push(p);
      return p;
    });
    const experts = [makeExpert("macro"), makeExpert("tech")];
    const fundamentalContext = "| NVDA | S | +145% | +122% | 예 | 예 |";

    await runRound1({
      getProvider,
      experts,
      question: "시장 분석",
      memoryContext: "",
      fundamentalContext,
    });

    expect(providers).toHaveLength(2);
    for (const p of providers) {
      const callArgs = (p.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.userMessage).toContain("<fundamental-data>");
      expect(callArgs.userMessage).toContain("</fundamental-data>");
      expect(callArgs.userMessage).toContain("NVDA");
      expect(callArgs.userMessage).toContain("Phase 2 종목 펀더멘탈 데이터 (SEPA)");
    }
  });

  it("fundamentalContext는 newsContext 뒤에 추가된다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];

    await runRound1({
      getProvider,
      experts,
      question: "시장 분석",
      memoryContext: "",
      newsContext: { macro: "뉴스: FOMC 결과" },
      fundamentalContext: "| NVDA | S |",
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newsIdx = callArgs.userMessage.indexOf("FOMC 결과");
    const fundIdx = callArgs.userMessage.indexOf("<fundamental-data>");
    expect(newsIdx).toBeLessThan(fundIdx);
  });

  it("memoryContext는 systemPrompt에, fundamentalContext는 userMessage에 주입된다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];

    await runRound1({
      getProvider,
      experts,
      question: "시장 분석",
      memoryContext: "장기 기억 데이터",
      fundamentalContext: "| NVDA | S |",
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("장기 기억 데이터");
    expect(callArgs.systemPrompt).not.toContain("fundamental-data");
    expect(callArgs.userMessage).toContain("<fundamental-data>");
    expect(callArgs.userMessage).not.toContain("장기 기억 데이터");
  });

  it("전문가 실패 시에도 다른 전문가는 fundamentalContext를 정상 수신한다", async () => {
    let callCount = 0;
    const successProvider = makeMockProvider();
    const getProvider = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          call: vi.fn().mockRejectedValue(new Error("API error")),
        };
      }
      return successProvider;
    });
    const experts = [makeExpert("macro"), makeExpert("tech")];

    const result = await runRound1({
      getProvider,
      experts,
      question: "시장 분석",
      memoryContext: "",
      fundamentalContext: "| NVDA | S |",
    });

    expect(result.round.outputs).toHaveLength(1);
    const callArgs = (successProvider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.userMessage).toContain("<fundamental-data>");
  });
});
