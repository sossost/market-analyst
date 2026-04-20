import type { LLMProvider } from "./llm/index.js";
import { logger } from "@/lib/logger";
import type { AgentPersona, RoundOutput, DebateRound } from "@/types/debate";
import type { PersonaDefinition } from "@/types/debate";

interface Round2Input {
  /** persona.model에서 provider를 생성하는 팩토리 함수 */
  getProvider: (model: string) => LLMProvider;
  experts: PersonaDefinition[];
  round1Outputs: RoundOutput[];
  question: string;
  /** 학습 메모리 컨텍스트 — 교차검증 시 과거 실패 패턴 반박 근거 활용 (#799) */
  memoryContext?: string;
  /** SEPA 기반 펀더멘탈 스코어 — 교차검증 시 실적 데이터 기반 반박/보완용 */
  fundamentalContext?: string;
  /** 조기포착 도구 결과 — pre-Phase 2 후보의 교차검증용 */
  earlyDetectionContext?: string;
  /** 촉매 데이터 (종목 뉴스, 실적 서프라이즈, 임박 실적 발표) */
  catalystContext?: string;
  /** 원본 시장 데이터 — Round 1 인용 정확성 검증용 (#936) */
  marketDataContext?: string;
  /** 전 전문가 뉴스 합산 — Round 1 선택적 인용 검증용 (#936) */
  newsContext?: string;
}

interface Round2Result {
  round: DebateRound;
  tokensUsed: { input: number; output: number };
}

export function buildCrossfirePrompt(
  currentPersona: AgentPersona,
  round1Outputs: RoundOutput[],
  question: string,
  fundamentalContext?: string,
  earlyDetectionContext?: string,
  catalystContext?: string,
  marketDataContext?: string,
  newsContext?: string,
): string {
  const othersAnalysis = round1Outputs
    .filter((o) => o.persona !== currentPersona)
    .map((o) => `### ${o.persona} 분석\n${o.content}`)
    .join("\n\n---\n\n");

  let prompt = `## 교차 검증 라운드

### 원래 질문
${question}

### 다른 애널리스트들의 독립 분석

${othersAnalysis}

---

위 분석들을 검토하고 아래 형식으로 답하라:

### 1. 반박 (최소 1가지 필수)
다른 애널리스트의 분석에서 **논리적 허점, 간과된 리스크, 과도한 낙관/비관**을 지적하라.
구체적으로 누구의 어떤 주장이 왜 틀렸거나 약한지 밝혀라.
동의만 하는 것은 가치 없다. 반드시 최소 1가지는 반박하라.

### 2. 보완
당신의 전문 영역에서 다른 애널리스트들이 놓친 인사이트를 추가하라.

### 3. 수정된 전망
다른 분석을 반영하여 당신의 Round 1 판단을 수정하라.
수정할 것이 없으면 왜 기존 판단을 유지하는지 근거를 밝혀라.

### 4. 병목 판단 교차 검증
라운드 1에서 각자의 병목 상태 판단을 한 줄로 재확인하고, 이견이 있을 경우:
- 어느 판단이 더 근거가 있는가?
- RESOLVING 신호로 제시된 뉴스가 실제 신호인가, 아직 초기 투자인가?
  (CAPEX 발표는 병목 해소 시그널이 아니라 수요 확인 시그널일 수 있다)
- 각자가 제시한 N+1 병목 예측 중 더 가능성 높은 것은?

### 5. 정책 신호 교차 검증 (geopolitics의 정책 신호 평가가 있는 경우에만 작성)
- geopolitics 애널리스트가 제시한 정책 신호 단계 평가에 이견이 있는가?
  (예: "Stage 3 완료라고 했는데 실제로는 아직 집행 규정 마련 중 아닌가?")
- 정책 타이밍과 시장 반영 판단이 다른 거시 지표와 일관성이 있는가?

### 6. 조기포착 후보 교차 검증 (아래 조기포착 데이터가 있는 경우에만 작성)
- 다른 애널리스트가 언급한 조기포착 후보 중 펀더멘탈 근거가 부족한 종목을 지적하라.
- 아래 펀더멘탈 데이터를 참조하여, B등급 미만 종목의 추천에 대해 반론하라.
- 조기포착 후보가 당신의 전문 영역 관점에서 구조적 수혜를 받을 수 있는지 평가하라.`;

  // 펀더멘탈 데이터 조건부 추가
  if (fundamentalContext != null && fundamentalContext.length > 0) {
    prompt += `\n\n---\n\n<fundamental-data>\n## 교차검증용 펀더멘탈 데이터 (SEPA)\n\n아래 실적 데이터를 참조하여 다른 애널리스트의 종목 추천을 검증하세요.\nB등급 미만 종목 추천에 대해서는 "펀더멘탈 미검증"을 지적해야 합니다.\n\n${fundamentalContext}\n</fundamental-data>`;
  }

  // 조기포착 후보 조건부 추가
  if (earlyDetectionContext != null && earlyDetectionContext.length > 0) {
    prompt += `\n\n---\n\n<early-detection>\n## 조기포착 후보 (pre-Phase 2)\n\n아래는 아직 Phase 2에 진입하지 않았으나, 조기 전환 신호가 감지된 종목입니다.\n다른 애널리스트의 이 종목들에 대한 평가를 검증하고, 펀더멘탈 근거가 부족한 경우 지적하세요.\n\n${earlyDetectionContext}\n</early-detection>`;
  }

  // 촉매 데이터 조건부 추가
  if (catalystContext != null && catalystContext.length > 0) {
    prompt += `\n\n---\n\n<catalyst-data>\n## 촉매 데이터 (뉴스/실적)\n\n아래 촉매 데이터를 참조하여 다른 애널리스트의 섹터 강세 판단 근거를 교차검증하세요.\n실적 서프라이즈 비트율과 뉴스 헤드라인이 해당 섹터/종목의 thesis를 뒷받침하는지 확인하세요.\n\n${catalystContext}\n</catalyst-data>`;
  }

  // 원본 시장 데이터 — Round 1 인용 정확성 검증용 (#936)
  if (marketDataContext != null && marketDataContext.length > 0) {
    prompt += `\n\n---\n\n<market-data>\n## 원본 시장 데이터\n\n아래는 Round 1 전문가에게 제공된 원본 시장 데이터입니다.\n다른 애널리스트가 시장 데이터를 정확히 인용했는지 대조 검증하세요.\n수치 오인용이나 선택적 인용이 있으면 반박에서 지적하세요.\n\n${marketDataContext}\n</market-data>`;
  }

  // 전 전문가 뉴스 컨텍스트 — Round 1 선택적 인용 검증용 (#936)
  if (newsContext != null && newsContext.length > 0) {
    prompt += `\n\n---\n\n<news-context>\n## 전체 뉴스 컨텍스트\n\n아래는 각 전문가에게 제공된 뉴스입니다.\n다른 애널리스트가 뉴스를 선택적으로 인용하거나 누락한 부분이 있으면 지적하세요.\n\n${newsContext}\n</news-context>`;
  }

  return prompt;
}

/**
 * Round 2 — Crossfire.
 * Each expert reads others' Round 1 analysis and provides rebuttals/supplements.
 * Each expert uses the LLMProvider resolved from their persona.model.
 */
export async function runRound2(input: Round2Input): Promise<Round2Result> {
  const { getProvider, experts, round1Outputs, question, memoryContext = "", fundamentalContext, earlyDetectionContext, catalystContext, marketDataContext, newsContext } = input;

  let totalInput = 0;
  let totalOutput = 0;
  const outputs: RoundOutput[] = [];

  // Only include experts that produced Round 1 output
  const activePersonas = new Set(round1Outputs.map((o) => o.persona));
  const activeExperts = experts.filter((e) => activePersonas.has(e.name as AgentPersona));

  // Rate limit 회피: 2명씩 배치, 배치 간 딜레이
  const BATCH_SIZE = 2;
  const BATCH_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 10_000;
  for (let i = 0; i < activeExperts.length; i += BATCH_SIZE) {
    if (i > 0 && BATCH_DELAY_MS > 0) {
      logger.info("Round2", `Batch delay ${BATCH_DELAY_MS / 1000}s (rate limit mitigation)`);
      await new Promise<void>((r) => setTimeout(r, BATCH_DELAY_MS));
    }
    const batch = activeExperts.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (expert) => {
        const persona = expert.name as AgentPersona;
        const userMessage = buildCrossfirePrompt(persona, round1Outputs, question, fundamentalContext, earlyDetectionContext, catalystContext, marketDataContext, newsContext);
        let systemPrompt = expert.systemPrompt;
        if (memoryContext.length > 0) {
          systemPrompt += `\n\n## 장기 기억 (검증된 원칙)\n${memoryContext}`;
        }
        const provider = getProvider(expert.model);
        const result = await provider.call({
          systemPrompt,
          userMessage,
        });
        return { persona, result };
      }),
    );

    for (const settled of results) {
      if (settled.status === "fulfilled") {
        const { persona, result } = settled.value;
        outputs.push({ persona, content: result.content });
        totalInput += result.tokensUsed.input;
        totalOutput += result.tokensUsed.output;
        logger.info(
          "Round2",
          `${persona} completed (${result.tokensUsed.output} output tokens)`,
        );
      } else {
        const errorMsg =
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
        logger.error("Round2", `Crossfire failed: ${errorMsg}`);
      }
    }
  }

  if (outputs.length === 0) {
    throw new Error("Round 2 failed: no agents produced output");
  }

  return {
    round: { round: 2, outputs },
    tokensUsed: { input: totalInput, output: totalOutput },
  };
}
