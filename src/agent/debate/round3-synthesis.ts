import Anthropic from "@anthropic-ai/sdk";
import { callAgent } from "./callAgent.js";
import { logger } from "../logger.js";
import type { RoundOutput, SynthesisResult, Thesis } from "../../types/debate.js";
import type { PersonaDefinition } from "../../types/debate.js";

const MODERATOR_MAX_TOKENS = 8192;

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

  return `## 시장 분석 종합 요청

### 질문
${question}

---

## 분석가 A 그룹 — 독립 분석

${round1Section}

---

## 분석가 B 그룹 — 교차 검증

${round2Section}

---

위 분석 내용을 종합하여 **투자자가 바로 활용할 수 있는 시장 브리핑**을 작성해 주세요.

## 브리핑 구조 (아래 순서대로 작성)

### 1. 핵심 요약 (3줄 이내)
- 지금 시장에서 가장 중요한 구조적 변화 한 줄
- 주목해야 할 섹터/테마 한 줄 (구체적 ETF 티커 포함)
- 주의해야 할 리스크 한 줄

### 2. 시장 환경 판단
- 주요 지수 현재 수준 + 전일 대비 변동 + **그 의미를 한 문장으로 해석**
- 핵심 매크로 지표 (금리, 유가, VIX, 달러 등) + 의미 해석
- 단순 숫자 나열 금지. 숫자마다 "이게 왜 중요한지" 붙여서 설명

### 3. 핵심 발견 (1~2가지만)
- 분석을 통해 도출된 **가장 중요하고 차별화된 구조적 인사이트**
- 뻔한 말 금지. "변동성 확대", "리스크 관리 필요" 같은 말은 가치 없음
- 각 발견에 대해 **근거 데이터**와 **왜 중요한지** 3~5줄로 상세히 설명
- 해당 변화로 인해 **어떤 섹터/산업이 구조적 수혜를 받는지** 연결

### 4. 주도섹터/주도주 전망 (가장 중요한 섹션)
우리의 목표는 **상승 초입에 진입 중인 섹터와 종목을 남들보다 먼저 포착**하는 것입니다.

#### 부상하는 섹터/테마
- 구조적 성장이 시작되거나 가속화되는 섹터/테마
- **왜 지금 이 섹터인지** — 촉매, 자금 흐름, 펀더멘털 변화 근거
- 관련 ETF 티커와 대표 종목 티커

#### 주의해야 할 섹터
- 모멘텀이 꺾이거나 과열 신호가 보이는 섹터
- 구조적 역풍을 맞고 있는 산업
- 왜 지금 비중을 줄여야 하는지 근거

※ 목표가/손절가 같은 트레이딩 시그널은 쓰지 마세요. 우리는 단기 매매가 아니라 **구조적 변화의 초기 신호를 포착**하는 것이 목표입니다.
※ ETF 티커(QQQ, SPY 등)와 지수(Nasdaq, S&P 500)를 혼동하지 마세요

### 5. 분석가 간 이견 (있을 경우만)
- 의견이 갈리는 핵심 포인트 1가지
- 각 입장의 핵심 근거를 2~3줄로

### 6. 향후 주목할 이벤트
- 다음 1~2주 내 시장에 영향을 줄 수 있는 주요 이벤트 (FOMC, 실적 발표 등)
- 각 이벤트가 위 분석에 어떤 영향을 미칠 수 있는지

## 품질 기준
- **반드시 한국어로만 작성**하세요. 일본어, 영어 문장 혼재 금지.
- 모든 수치에 **날짜 기준**을 명시하세요
- 리포트의 목표는 **구조적 변화의 초기 신호를 포착하여 상승 초입 섹터/주도주를 선점**하는 것입니다
- 트레이딩 시그널(목표가, 손절가, 진입가)이 아니라 **왜 이 섹터가 지금 부상하는지**에 집중하세요

## 용어 규칙 (필수)
리포트에서 아래 용어 변환을 반드시 적용하세요:
- "Phase 1" → **"바닥 다지기"**
- "Phase 2" 또는 "Phase 2 진입" → **"상승 초입"** 또는 **"상승 전환"**
- "Phase 3" → **"과열/천장권"**
- "Phase 4" → **"하락 추세"**
- "Phase 1→2 전환" → **"바닥 돌파"** 또는 **"상승 전환 진입"**
- 내부 시스템 용어(Phase 1/2/3/4)를 리포트에 그대로 노출하지 마세요.
- 이전 라운드 분석에서 제공된 데이터만 사용하세요. **제공되지 않은 수치를 추정하거나 지어내지 마세요.**
- **출처/소스 URL을 리포트에 포함하지 마세요.** 깔끔한 분석 리포트를 작성하세요.
- 최소 1,500자 이상 작성하세요

---

## 검증 가능한 전망 추출 (JSON)

리포트 마지막에 아래 JSON을 추가해 주세요. 이 부분은 시스템이 자동 파싱하므로 반드시 코드블록 안에 넣어주세요.
전망이 없으면 빈 배열 \`[]\`을 반환하세요.

**전망 품질 기준:**
- 반드시 **현재 기준 가격/수치**를 포함 (예: "NVDA $820 기준, 60일 내 $650까지 조정")
- "상승할 것"만으로는 부족. **구체적 숫자 목표** 필수
- confidence "high"는 3/4 이상 합의 + 명확한 데이터 근거가 있을 때만
- ETF가 월간 20% 이상 등락하는 예측은 극단적 상황 아니면 지양

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

const VALID_PERSONAS = new Set<string>(["macro", "tech", "geopolitics", "sentiment"]);
const VALID_CONFIDENCE = new Set<string>(["low", "medium", "high"]);
const VALID_CONSENSUS = new Set<string>(["1/4", "2/4", "3/4", "4/4"]);
const VALID_TIMEFRAMES = new Set<number>([30, 60, 90]);

function isValidThesis(t: unknown): t is Thesis {
  if (t == null || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  return (
    VALID_PERSONAS.has(obj.agentPersona as string) &&
    VALID_CONFIDENCE.has(obj.confidence as string) &&
    VALID_CONSENSUS.has(obj.consensusLevel as string) &&
    VALID_TIMEFRAMES.has(obj.timeframeDays as number) &&
    typeof obj.thesis === "string" &&
    obj.thesis.length > 0 &&
    typeof obj.verificationMetric === "string" &&
    typeof obj.targetCondition === "string"
  );
}

interface ExtractionResult {
  theses: Thesis[];
  cleanReport: string;
}

/**
 * Extract thesis JSON array from moderator output and return clean report.
 * JSON block is removed from the report (system-only data, not for users).
 * Returns empty array on parse failure (conservative).
 */
export function extractThesesFromText(text: string): ExtractionResult {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch == null) {
    logger.warn("Round3", "No JSON block found in moderator output");
    return { theses: [], cleanReport: text };
  }

  // JSON 블록과 그 앞의 헤더/설명 텍스트를 제거하여 유저용 리포트 생성
  const cleanReport = text
    .replace(/#{1,3}\s*(?:검증 가능한 전망 추출|Thesis 추출|전망 추출)[^\n]*\n?/gi, "")
    .replace(/```json\s*[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(parsed)) {
      logger.warn("Round3", "Parsed JSON is not an array");
      return { theses: [], cleanReport };
    }
    const validated = parsed.filter((t: unknown) => isValidThesis(t));
    if (validated.length < parsed.length) {
      logger.warn("Round3", `Filtered ${parsed.length - validated.length} invalid theses`);
    }
    return { theses: validated, cleanReport };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("Round3", `Failed to parse thesis JSON: ${msg}`);
    return { theses: [], cleanReport };
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
    maxTokens: MODERATOR_MAX_TOKENS,
    disableTools: true,
  });

  const { theses, cleanReport } = extractThesesFromText(result.content);
  logger.info("Round3", `Synthesis complete: ${theses.length} theses extracted`);

  return {
    synthesis: {
      report: cleanReport,
      theses,
    },
    tokensUsed: result.tokensUsed,
  };
}
