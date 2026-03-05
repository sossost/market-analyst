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

## 종합 구조

1. **핵심 발견**: 이번 토론에서 나온 가장 중요한 발견 1~2가지만. 뻔한 말 금지.
2. **쟁점**: 의견이 갈리는 핵심 포인트 + 각 입장의 핵심 근거 한 줄씩
3. **실행 시사점**: 구체적인 종목/ETF 티커, 방향(매수/매도/관망), 조건을 반드시 포함

## 품질 기준 (필수)
- **"시장 변동성 확대", "리스크 관리 필요" 같은 뻔한 말은 쓰지 마세요.** 누구나 아는 걸 합의하는 건 가치가 없습니다.
- 모든 수치에 **현재 기준값과 날짜**를 반드시 명시하세요.
- 실행 시사점에는 **구체적 티커(종목/ETF)와 진입/이탈 조건**을 포함하세요.

## Thesis 추출

마지막에 아래 JSON 형식으로 검증 가능한 thesis를 추출해 주세요.
thesis가 없으면 빈 배열 \`[]\`을 반환하세요.

**Thesis 품질 기준:**
- 반드시 **현재 기준 가격/수치**를 포함할 것 (예: "NVDA $820 기준, 60일 내 $650까지 조정")
- "상승할 것", "하락할 것"만으로는 부족. **구체적 숫자 목표**가 있어야 함
- confidence "high"는 3/4 이상 합의 + 명확한 데이터 근거가 있을 때만

\`\`\`json
[
  {
    "agentPersona": "macro|tech|geopolitics|sentiment",
    "thesis": "현재 기준값 포함한 구체적 예측 문장",
    "timeframeDays": 30|60|90,
    "verificationMetric": "검증에 사용할 지표 (티커 또는 지수명)",
    "targetCondition": "구체적 숫자 목표 (현재가 대비)",
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
  const result = await callAgent(client, moderator.systemPrompt, userMessage, {
    maxTokens: 8192,
  });

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
