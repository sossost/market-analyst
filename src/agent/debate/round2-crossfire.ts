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

### 다른 장관들의 독립 분석

${othersAnalysis}

---

위 분석들을 검토한 후:
1. **반박할 점**: 논리적 허점, 간과된 리스크, 과도한 낙관/비관
2. **보완할 점**: 당신의 전문 영역에서 추가할 인사이트
3. **동의하는 점**: 강력하게 동의하는 분석과 그 이유
4. **수정된 전망**: 다른 분석을 반영한 당신의 최종 의견`;
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

  const results = await Promise.allSettled(
    activeExperts.map(async (expert) => {
      const persona = expert.name as AgentPersona;
      const userMessage = buildCrossfirePrompt(persona, round1Outputs, question);
      const result = await callAgent(client, expert.systemPrompt, userMessage);
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

  if (outputs.length === 0) {
    throw new Error("Round 2 failed: no agents produced output");
  }

  return {
    round: { round: 2, outputs },
    tokensUsed: { input: totalInput, output: totalOutput },
  };
}
