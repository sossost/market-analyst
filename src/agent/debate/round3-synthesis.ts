import Anthropic from "@anthropic-ai/sdk";
import { callAgent } from "./callAgent.js";
import { logger } from "../logger.js";
import type { RoundOutput, SynthesisResult, Thesis } from "../../types/debate.js";
import type { PersonaDefinition } from "../../types/debate.js";

interface Round3Input {
  client: Anthropic;
  moderator: PersonaDefinition;
  round1Outputs: RoundOutput[];
  round2Outputs: RoundOutput[];
  question: string;
}

interface Round3Result {
  synthesis: SynthesisResult;
  tokensUsed: { input: number; output: number };
}

function buildSynthesisPrompt(
  round1Outputs: RoundOutput[],
  round2Outputs: RoundOutput[],
  question: string,
): string {
  const round1Section = round1Outputs
    .map((o) => `### ${o.persona} (독립 분석)\n${o.content}`)
    .join("\n\n---\n\n");

  const round2Section = round2Outputs
    .map((o) => `### ${o.persona} (교차 검증)\n${o.content}`)
    .join("\n\n---\n\n");

  return `## 토론 종합 요청

### 원래 질문
${question}

---

## 라운드 1: 독립 분석

${round1Section}

---

## 라운드 2: 교차 검증

${round2Section}

---

위 토론 내용을 종합해 주세요.

1. **합의 사항**: 3명 이상이 동의하는 핵심 분석
2. **불일치 사항**: 의견이 갈리는 쟁점 + 각 입장 요약
3. **핵심 인사이트**: 토론을 통해 도출된 가장 중요한 발견
4. **실행 가능한 시사점**: 투자 관점에서의 구체적 함의

마지막에 아래 JSON 형식으로 검증 가능한 thesis를 추출해 주세요.
thesis가 없으면 빈 배열 \`[]\`을 반환하세요.

\`\`\`json
[
  {
    "agentPersona": "macro|tech|geopolitics|sentiment",
    "thesis": "검증 가능한 예측 문장",
    "timeframeDays": 30|60|90,
    "verificationMetric": "검증에 사용할 지표",
    "targetCondition": "달성 조건",
    "invalidationCondition": "무효화 조건",
    "confidence": "low|medium|high",
    "consensusLevel": "4/4|3/4|2/4|1/4"
  }
]
\`\`\``;
}

/**
 * Extract thesis JSON array from moderator output.
 * Returns empty array on parse failure (conservative).
 */
export function extractThesesFromText(text: string): Thesis[] {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch == null) {
    logger.warn("Round3", "No JSON block found in moderator output");
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed)) {
      logger.warn("Round3", "Parsed JSON is not an array");
      return [];
    }
    return parsed as Thesis[];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("Round3", `Failed to parse thesis JSON: ${msg}`);
    return [];
  }
}

/**
 * Round 3 — Moderator Synthesis.
 * Moderator reads all Round 1 + Round 2 outputs and produces a synthesis report + thesis JSON.
 */
export async function runRound3(input: Round3Input): Promise<Round3Result> {
  const { client, moderator, round1Outputs, round2Outputs, question } = input;

  const userMessage = buildSynthesisPrompt(round1Outputs, round2Outputs, question);
  const result = await callAgent(client, moderator.systemPrompt, userMessage);

  const theses = extractThesesFromText(result.content);
  logger.info("Round3", `Synthesis complete: ${theses.length} theses extracted`);

  return {
    synthesis: {
      report: result.content,
      theses,
    },
    tokensUsed: result.tokensUsed,
  };
}
