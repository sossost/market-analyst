import { describe, it, expect, vi } from "vitest";
import { buildCrossfirePrompt, runRound2 } from "../round2-crossfire.js";
import type { AgentPersona, RoundOutput } from "@/types/debate";
import type { PersonaDefinition } from "@/types/debate";
import type { LLMProvider } from "../llm/index.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRoundOutput(persona: AgentPersona, content: string): RoundOutput {
  return { persona, content };
}

function makeMockProvider(content = "mock crossfire"): LLMProvider {
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

// ─── buildCrossfirePrompt ────────────────────────────────────────────────────

describe("buildCrossfirePrompt", () => {
  const round1Outputs = [
    makeRoundOutput("macro", "매크로 분석"),
    makeRoundOutput("tech", "테크 분석"),
  ];
  const question = "시장 분석";

  it("fundamentalContext가 없으면 fundamental-data 태그가 포함되지 않는다", () => {
    const result = buildCrossfirePrompt("macro", round1Outputs, question);

    expect(result).not.toContain("<fundamental-data>");
    expect(result).not.toContain("</fundamental-data>");
  });

  it("빈 fundamentalContext면 fundamental-data 태그가 포함되지 않는다", () => {
    const result = buildCrossfirePrompt("macro", round1Outputs, question, "");

    expect(result).not.toContain("<fundamental-data>");
  });

  it("fundamentalContext가 있으면 프롬프트에 포함된다", () => {
    const fundCtx = "| NVDA | S | +145% | +122% | 예 | 예 |";
    const result = buildCrossfirePrompt("macro", round1Outputs, question, fundCtx);

    expect(result).toContain("<fundamental-data>");
    expect(result).toContain("</fundamental-data>");
    expect(result).toContain("NVDA");
    expect(result).toContain("교차검증용 펀더멘탈 데이터 (SEPA)");
  });

  it("earlyDetectionContext가 없으면 early-detection 태그가 포함되지 않는다", () => {
    const result = buildCrossfirePrompt("macro", round1Outputs, question);

    expect(result).not.toContain("<early-detection>");
    expect(result).not.toContain("</early-detection>");
  });

  it("빈 earlyDetectionContext면 early-detection 태그가 포함되지 않는다", () => {
    const result = buildCrossfirePrompt("macro", round1Outputs, question, undefined, "");

    expect(result).not.toContain("<early-detection>");
  });

  it("earlyDetectionContext가 있으면 프롬프트에 포함된다", () => {
    const earlyCtx = "| AAPL | 45 | 0.0012 | 2.1x | Technology |";
    const result = buildCrossfirePrompt("macro", round1Outputs, question, undefined, earlyCtx);

    expect(result).toContain("<early-detection>");
    expect(result).toContain("</early-detection>");
    expect(result).toContain("AAPL");
    expect(result).toContain("조기포착 후보");
  });

  it("fundamentalContext와 earlyDetectionContext 모두 있으면 둘 다 포함된다", () => {
    const fundCtx = "| NVDA | S |";
    const earlyCtx = "| AAPL | 45 |";
    const result = buildCrossfirePrompt("macro", round1Outputs, question, fundCtx, earlyCtx);

    expect(result).toContain("<fundamental-data>");
    expect(result).toContain("<early-detection>");
  });

  it("fundamentalContext가 earlyDetectionContext보다 앞에 위치한다", () => {
    const fundCtx = "| NVDA | S |";
    const earlyCtx = "| AAPL | 45 |";
    const result = buildCrossfirePrompt("macro", round1Outputs, question, fundCtx, earlyCtx);

    const fundIdx = result.indexOf("<fundamental-data>");
    const earlyIdx = result.indexOf("<early-detection>");
    expect(fundIdx).toBeLessThan(earlyIdx);
  });

  it("조기포착 후보 교차 검증 지침이 포함된다", () => {
    const result = buildCrossfirePrompt("macro", round1Outputs, question);

    expect(result).toContain("조기포착 후보 교차 검증");
    expect(result).toContain("펀더멘탈 근거가 부족한 종목을 지적하라");
  });

  it("자신의 분석은 제외하고 다른 전문가의 분석만 포함한다", () => {
    const result = buildCrossfirePrompt("macro", round1Outputs, question);

    expect(result).toContain("tech 분석");
    expect(result).not.toContain("macro 분석");
  });
});

// ─── runRound2 ───────────────────────────────────────────────────────────────

describe("runRound2", () => {
  it("fundamentalContext와 earlyDetectionContext가 전문가에게 전달된다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro"), makeExpert("tech")];
    const round1Outputs = [
      makeRoundOutput("macro", "매크로 분석"),
      makeRoundOutput("tech", "테크 분석"),
    ];
    const fundCtx = "| NVDA | S | +145% |";
    const earlyCtx = "| AAPL | 45 |";

    await runRound2({
      getProvider,
      experts,
      round1Outputs,
      question: "시장 분석",
      fundamentalContext: fundCtx,
      earlyDetectionContext: earlyCtx,
    });

    const calls = (provider.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call[0].userMessage).toContain("<fundamental-data>");
      expect(call[0].userMessage).toContain("NVDA");
      expect(call[0].userMessage).toContain("<early-detection>");
      expect(call[0].userMessage).toContain("AAPL");
    }
  });

  it("context 없이 호출해도 정상 동작한다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];
    const round1Outputs = [makeRoundOutput("macro", "매크로 분석")];

    const result = await runRound2({
      getProvider,
      experts,
      round1Outputs,
      question: "시장 분석",
    });

    expect(result.round.outputs).toHaveLength(1);
    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.userMessage).not.toContain("<fundamental-data>");
    expect(callArgs.userMessage).not.toContain("<early-detection>");
  });

  it("memoryContext가 있으면 시스템 프롬프트에 장기 기억이 주입된다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];
    const round1Outputs = [makeRoundOutput("macro", "매크로 분석")];
    const memoryCtx = "### 검증된 패턴\n- 브레드스 악화 시 Phase 2 신호 신뢰도 낮음";

    await runRound2({
      getProvider,
      experts,
      round1Outputs,
      question: "시장 분석",
      memoryContext: memoryCtx,
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("장기 기억 (검증된 원칙)");
    expect(callArgs.systemPrompt).toContain("브레드스 악화 시 Phase 2 신호 신뢰도 낮음");
  });

  it("memoryContext가 빈 문자열이면 시스템 프롬프트에 주입되지 않는다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];
    const round1Outputs = [makeRoundOutput("macro", "매크로 분석")];

    await runRound2({
      getProvider,
      experts,
      round1Outputs,
      question: "시장 분석",
      memoryContext: "",
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.systemPrompt).not.toContain("장기 기억");
  });

  it("memoryContext가 없으면 시스템 프롬프트에 주입되지 않는다", async () => {
    const provider = makeMockProvider();
    const getProvider = vi.fn().mockReturnValue(provider);
    const experts = [makeExpert("macro")];
    const round1Outputs = [makeRoundOutput("macro", "매크로 분석")];

    await runRound2({
      getProvider,
      experts,
      round1Outputs,
      question: "시장 분석",
    });

    const callArgs = (provider.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.systemPrompt).not.toContain("장기 기억");
  });
});
