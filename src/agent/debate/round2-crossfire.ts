import Anthropic from "@anthropic-ai/sdk";
import { callAgent } from "./callAgent.js";
import { logger } from "../logger.js";
import type { AgentPersona, RoundOutput, DebateRound } from "../../types/debate.js";
import type { PersonaDefinition } from "../../types/debate.js";

interface Round2Input {
  client: Anthropic;
  experts: PersonaDefinition[];
  round1Outputs: RoundOutput[];
  question: string;
}

interface Round2Result {
  round: DebateRound;
  tokensUsed: { input: number; output: number };
}

function buildCrossfirePrompt(
  currentPersona: AgentPersona,
  round1Outputs: RoundOutput[],
  question: string,
): string {
  const othersAnalysis = round1Outputs
    .filter((o) => o.persona !== currentPersona)
    .map((o) => `### ${o.persona} 분석\n${o.content}`)
    .join("\n\n---\n\n");

  return `## 교차 검증 라운드

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

### 4. 병목 판단 교차 검증 (선택, 이견이 있을 경우)
라운드 1에서 서로 다른 병목 상태 판단이 있을 경우:
- 어느 판단이 더 근거가 있는가?
- RESOLVING 신호로 제시된 뉴스가 실제 신호인가, 아직 초기 투자인가?
  (CAPEX 발표는 병목 해소 시그널이 아니라 수요 확인 시그널일 수 있다)
- 각자가 제시한 N+1 병목 예측 중 더 가능성 높은 것은?`;
}

/**
 * Round 2 — Crossfire.
 * Each expert reads others' Round 1 analysis and provides rebuttals/supplements.
 */
export async function runRound2(input: Round2Input): Promise<Round2Result> {
  const { client, experts, round1Outputs, question } = input;

  let totalInput = 0;
  let totalOutput = 0;
  const outputs: RoundOutput[] = [];

  // Only include experts that produced Round 1 output
  const activePersonas = new Set(round1Outputs.map((o) => o.persona));
  const activeExperts = experts.filter(
    (e) => activePersonas.has(e.name as AgentPersona),
  );

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
        const userMessage = buildCrossfirePrompt(persona, round1Outputs, question);
        const result = await callAgent(client, expert.systemPrompt, userMessage, {
          disableTools: true,
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
        logger.info("Round2", `${persona} completed (${result.tokensUsed.output} output tokens)`);
      } else {
        const errorMsg = settled.reason instanceof Error
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
