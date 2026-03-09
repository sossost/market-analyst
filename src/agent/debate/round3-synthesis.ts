import Anthropic from "@anthropic-ai/sdk";
import { callAgent } from "./callAgent.js";
import { logger } from "../logger.js";
import type { RoundOutput, SynthesisResult, Thesis, ThesisCategory, MarketRegimeRaw, PersonaDefinition } from "../../types/debate.js";

const MODERATOR_MAX_TOKENS = 8192;

interface Round3Input {
  client: Anthropic;
  moderator: PersonaDefinition;
  round1Outputs: RoundOutput[];
  round2Outputs: RoundOutput[];
  question: string;
  /** Original market data for cross-validation */
  marketDataContext?: string;
}

interface Round3Result {
  synthesis: SynthesisResult;
  marketRegime: MarketRegimeRaw | null;
  tokensUsed: { input: number; output: number };
}

function buildSynthesisPrompt(
  round1Outputs: RoundOutput[],
  round2Outputs: RoundOutput[],
  question: string,
  marketDataContext?: string,
): string {
  const round1Section = round1Outputs
    .map((o) => `### ${o.persona} (독립 분석)\n${o.content}`)
    .join("\n\n---\n\n");

  const round2Section = round2Outputs
    .map((o) => `### ${o.persona} (교차 검증)\n${o.content}`)
    .join("\n\n---\n\n");

  const dataSection = marketDataContext != null && marketDataContext.length > 0
    ? `\n---\n\n## 원본 시장 데이터 (ETL 수집)\n\n아래는 실제 시장 데이터입니다. 분석가들이 이 데이터를 제대로 반영했는지 검증하세요.\n특히 Phase 2 진입 종목과 섹터 RS 순위를 리포트에 반드시 포함하세요.\n\n${marketDataContext}`
    : "";

  return `## 시장 분석 종합 요청

### 질문
${question}
${dataSection}

---

## 분석가 A 그룹 — 독립 분석

${round1Section}

---

## 분석가 B 그룹 — 교차 검증

${round2Section}

---

위 분석 내용을 종합하여 **투자자가 바로 활용할 수 있는 시장 브리핑**을 작성해 주세요.

## 브리핑 구조 (아래 순서대로 작성)

### 1. 핵심 한 줄
오늘 가장 중요한 것 단 하나. 문장 1개, 50자 이내.
"~가 ~로 전환됨" 또는 "~가 ~를 촉발할 가능성 증가" 형식.

### 2. 시장 데이터 (수치만, 해석 없이)
- 주요 지수 종가 + 등락률
- 핵심 매크로 지표 수치 (VIX, 금리, 달러 등)
- 단순 수치 나열. 해석은 섹션 3에서.

### 3. 핵심 발견 + 병목 상태
- 분석을 통해 도출된 **가장 중요하고 차별화된 구조적 인사이트** 1~2가지 + 각 근거
- 뻔한 말 금지. "변동성 확대", "리스크 관리 필요" 같은 말은 가치 없음
- 각 발견에 대해 **근거 데이터**와 **왜 중요한지** 3~5줄로 상세히 설명
- 해당 변화로 인해 **어떤 섹터/산업이 구조적 수혜를 받는지** 연결
- 현재 추적 중인 병목의 상태 (ACTIVE / RESOLVING / RESOLVED / OVERSUPPLY)
  - RESOLVING 이상 신호가 감지된 경우: "이탈 준비 시점 검토" 명시
  - N+1 병목 예측: 애널리스트들의 예측을 종합하여 다음 주목할 공급 체인 노드 제시
    (2명 이상 동일 지점 → nextBottleneck에 기록, 3명 이상 → "강한 예측"으로 표기)

### 4. 기회: 주도섹터/주도주 (가장 중요한 섹션)
우리의 목표는 **상승 초입에 진입 중인 섹터와 종목을 남들보다 먼저 포착**하는 것입니다.

아래 테이블 형식으로 정리한 뒤, 각 항목에 대해 서사를 보충하세요:

| 섹터/종목 | 근거 | 상태 |
|----------|------|------|

- **왜 지금 이 섹터인지** — 촉매, 자금 흐름, 펀더멘털 변화 근거
- 관련 ETF 티커와 대표 종목 티커
- 종목의 **현재 모멘텀 상태** 필수: 5일/20일 가격 변화율이 마이너스면 "고점 피로감 경계" 표기

※ 목표가/손절가 같은 트레이딩 시그널은 쓰지 마세요. 우리는 단기 매매가 아니라 **구조적 변화의 초기 신호를 포착**하는 것이 목표입니다.
※ ETF 티커(QQQ, SPY 등)와 지수(Nasdaq, S&P 500)를 혼동하지 마세요

### 5. 경고: 과열/위험 종목
- 모멘텀이 꺾이거나 과열 신호가 보이는 섹터
- **RS는 높지만 가격이 하락 중인 종목** — 고점 피로감 가능성
- 구조적 역풍을 맞고 있는 산업
- 왜 지금 비중을 줄여야 하는지 근거

### 6. 분석가 이견 (있을 경우만)
- 의견이 갈리는 핵심 포인트 1가지
- 각 입장의 핵심 근거를 2~3줄로

### 7. 이벤트 캘린더
- 다음 1~2주 내 주요 이벤트를 **날짜 오름차순**으로 정렬
- 형식: YYYY-MM-DD | 이벤트명 | 위 분석에 미치는 영향 (1줄)

**섹션 간 규칙:**
- 섹션 2는 수치만. 해석이 들어가면 섹션 3으로 이동.
- 섹션 4와 5는 반드시 별도 섹션. 경고 종목을 기회 섹션에 넣지 말 것.
- 섹션 7 이벤트는 날짜 오름차순 정렬 필수.

## 수치 정확성 (가장 중요한 규칙)
- **위에 제공된 데이터(ETL 수집 데이터 + 분석가 라운드 1·2 인용)에 있는 수치만 사용하세요.**
- 제공되지 않은 수치를 절대 지어내지 마세요. 위반 예시:
  - "X년 만의 최대/최저" — 역사적 비교 수치가 제공되지 않았으면 쓰지 마세요
  - "Capex $X억" — ETL 데이터에 없는 기업 재무 수치를 추정하지 마세요
  - "PCE X%", "CPI X%" — 매크로 지표가 제공되지 않았으면 쓰지 마세요
  - "YoY +X%" — 전년 대비 수치가 데이터에 없으면 쓰지 마세요
- 뉴스에서 인용된 수치는 "뉴스 보도에 따르면"으로 출처를 표기하세요
- **확신이 없으면 수치를 빼세요. 틀린 수치보다 수치 없는 문장이 낫습니다.**

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

**카테고리 분류 기준:**
- \`structural_narrative\`: 수요-공급-병목 서사 기반 전망. 기본 timeframe 60~90일.
- \`sector_rotation\`: 섹터 로테이션 전망. 기본 timeframe 30~60일.
- \`short_term_outlook\`: 단기 시장/지수 전망. 기본 timeframe 30일.

**정량 조건 작성 규칙 (중요):**
- targetCondition과 invalidationCondition은 **가능한 한 수치 비교 형식**으로 작성하세요
- 형식: "[지표] [비교연산자] [숫자]" (예: "S&P 500 > 5800", "VIX < 20", "NVDA > 850")
- 비교연산자: >, <, >=, <=
- 정량 조건이 있으면 시스템이 **자동으로 시장 데이터와 비교 검증**합니다
- 정량 조건이 없으면 LLM이 주관적으로 판정하게 되어 검증 신뢰도가 떨어집니다
- "기술주 실적 호조 지속" 같은 정성적 조건은 **불가피한 경우에만** 사용하세요

\`\`\`json
[
  {
    "agentPersona": "macro|tech|geopolitics|sentiment",
    "thesis": "현재 기준값 포함한 구체적 예측 문장",
    "category": "structural_narrative|sector_rotation|short_term_outlook",
    "timeframeDays": 30|60|90,
    "verificationMetric": "검증에 사용할 지표 (티커 또는 지수명)",
    "targetCondition": "S&P 500 > 5800",
    "invalidationCondition": "S&P 500 < 5500",
    "confidence": "low|medium|high",
    "consensusLevel": "4/4|3/4|2/4|1/4",
    "nextBottleneck": "광트랜시버 대역폭 제한",
    "dissentReason": "지정학 분석가: 공급 체인 재편 속도 과대평가 우려"
  }
]
\`\`\`

**nextBottleneck 작성 규칙 (강화):**
- structural_narrative 카테고리에만 작성.
- 라운드 1·2에서 2명 이상이 동일 지점을 언급한 경우에만 작성. 그 외는 null.
- 형식: "공급 체인 노드 + 예상 시점" (예: "HBM 용량 제한 — GPU 병목 해소 후 2~3분기 내")
- 현재 병목이 ACTIVE 초기 단계라면 null (아직 N+1을 논하기 이른 단계)

**dissentReason 작성 규칙:**
- 합의되지 않은 의견이 있을 경우 \`dissentReason\`에 반대 입장 1~2줄 요약. 만장일치면 null.

## 시장 레짐 판정 (JSON)

리포트 마지막에 아래 JSON 블록을 **별도의 코드블록**으로 추가하세요.
이 데이터는 시스템이 자동 파싱합니다.

레짐 분류 기준:
- EARLY_BULL: 브레드스 반전 신호, 상승 전환 비율 상승 초기, 지수 바닥 확인 구간
- MID_BULL: 다수 섹터 상승 전환, RS 상위 종목 다수, 추천 적극성 정상
- LATE_BULL: 소수 종목만 주도, 브레드스 피크 후 하락, 과열 신호
- EARLY_BEAR: 브레드스 급락, 하락 추세 비율 상승, 방어 필요
- BEAR: 다수 섹터 하락 추세, 상승 전환 신호 신뢰도 매우 낮음

macro-economist의 round1 분석을 최우선으로 참조.
확신이 없으면 confidence: 'low'로 표기.

\`\`\`json
{
  "marketRegime": {
    "regime": "MID_BULL",
    "rationale": "판정 근거 2~4줄",
    "confidence": "low|medium|high"
  }
}
\`\`\``;
}

const VALID_PERSONAS = new Set<string>(["macro", "tech", "geopolitics", "sentiment"]);
const VALID_CONFIDENCE = new Set<string>(["low", "medium", "high"]);
const VALID_CONSENSUS = new Set<string>(["1/4", "2/4", "3/4", "4/4"]);
const VALID_TIMEFRAMES = new Set<number>([30, 60, 90]);
const VALID_CATEGORIES = new Set<string>([
  "structural_narrative",
  "sector_rotation",
  "short_term_outlook",
]);

/**
 * thesis 객체의 optional/category 필드를 정규화.
 * 순수 함수 — 원본을 변경하지 않고 새 객체를 반환.
 */
function normalizeThesisFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const category =
    obj.category == null || !VALID_CATEGORIES.has(obj.category as string)
      ? ("short_term_outlook" satisfies ThesisCategory)
      : obj.category;

  return {
    ...obj,
    category,
    nextBottleneck: obj.nextBottleneck ?? null,
    dissentReason: obj.dissentReason ?? null,
  };
}

function isValidThesis(t: unknown): t is Thesis {
  if (t == null || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;

  return (
    VALID_PERSONAS.has(obj.agentPersona as string) &&
    VALID_CONFIDENCE.has(obj.confidence as string) &&
    VALID_CONSENSUS.has(obj.consensusLevel as string) &&
    VALID_TIMEFRAMES.has(obj.timeframeDays as number) &&
    VALID_CATEGORIES.has(obj.category as string) &&
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

export interface DebateExtractionResult extends ExtractionResult {
  marketRegime: MarketRegimeRaw | null;
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
    const normalized = parsed.map((t: unknown) => {
      if (t != null && typeof t === "object") {
        return normalizeThesisFields(t as Record<string, unknown>);
      }
      return t;
    });
    const validated = normalized.filter((t: unknown) => isValidThesis(t));
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
 * Extract thesis JSON array AND marketRegime JSON from moderator output.
 * Parses each JSON block independently: thesis = array, regime = object.
 */
export function extractDebateOutput(text: string): DebateExtractionResult {
  // thesis: 배열 JSON 블록 추출
  const theses = (() => {
    const jsonMatch = text.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    if (jsonMatch == null) {
      logger.warn("Round3", "No thesis JSON block found in moderator output");
      return [];
    }
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (!Array.isArray(parsed)) {
        logger.warn("Round3", "Parsed thesis JSON is not an array");
        return [];
      }
      const normalized = parsed.map((t: unknown) => {
        if (t != null && typeof t === "object") {
          return normalizeThesisFields(t as Record<string, unknown>);
        }
        return t;
      });
      const validated = normalized.filter((t: unknown) => isValidThesis(t));
      if (validated.length < parsed.length) {
        logger.warn("Round3", `Filtered ${parsed.length - validated.length} invalid theses`);
      }
      return validated;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn("Round3", `Failed to parse thesis JSON: ${msg}`);
      return [];
    }
  })();

  // regime: 객체 JSON 블록 추출
  const marketRegime = extractMarketRegime(text);

  // 두 JSON 블록과 관련 헤더를 모두 제거
  const cleanReport = text
    .replace(/#{1,3}\s*(?:검증 가능한 전망 추출|Thesis 추출|전망 추출|시장 레짐 판정)[^\n]*\n?/gi, "")
    .replace(/```json\s*\[[\s\S]*?\]\s*```/g, "") // Theses JSON block (배열)
    .replace(/```json\s*\{[\s\S]*?"marketRegime"[\s\S]*?\}\s*```/g, "") // Regime JSON block (객체)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    theses,
    cleanReport,
    marketRegime,
  };
}

/**
 * Extract marketRegime JSON object from text.
 * Returns null on parse failure (conservative).
 */
function extractMarketRegime(text: string): MarketRegimeRaw | null {
  // marketRegime JSON은 별도 코드블록으로 온다
  // 패턴: ```json { "marketRegime": { ... } } ```
  const regimeMatch = text.match(/```json\s*(\{[\s\S]*?"marketRegime"[\s\S]*?\})\s*```/);
  if (regimeMatch == null) {
    logger.warn("Round3", "No marketRegime JSON block found");
    return null;
  }

  try {
    const parsed = JSON.parse(regimeMatch[1]);
    const regime = parsed.marketRegime;
    if (regime == null || typeof regime !== "object") {
      logger.warn("Round3", "marketRegime field is not an object");
      return null;
    }
    return {
      regime: String(regime.regime ?? ""),
      rationale: String(regime.rationale ?? ""),
      confidence: String(regime.confidence ?? "low"),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("Round3", `Failed to parse marketRegime JSON: ${msg}`);
    return null;
  }
}

/**
 * Round 3 — Moderator Synthesis.
 * Moderator reads all Round 1 + Round 2 outputs and produces a synthesis report + thesis JSON.
 */
export async function runRound3(input: Round3Input): Promise<Round3Result> {
  const { client, moderator, round1Outputs, round2Outputs, question, marketDataContext } = input;

  const userMessage = buildSynthesisPrompt(round1Outputs, round2Outputs, question, marketDataContext);
  const result = await callAgent(client, moderator.systemPrompt, userMessage, {
    maxTokens: MODERATOR_MAX_TOKENS,
    disableTools: true,
  });

  const { theses, cleanReport, marketRegime } = extractDebateOutput(result.content);
  logger.info("Round3", `Synthesis complete: ${theses.length} theses extracted`);

  return {
    synthesis: {
      report: cleanReport,
      theses,
    },
    marketRegime,
    tokensUsed: result.tokensUsed,
  };
}
