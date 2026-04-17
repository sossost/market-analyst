import type { LLMProvider } from "./llm/index.js";
import { loadConfirmedRegime, ALLOWED_TRANSITIONS, type MarketRegimeRow } from "./regimeStore.js";
import { logger } from "@/lib/logger";
import type { RoundOutput, SynthesisResult, Thesis, ThesisCategory, MarketRegimeRaw, PersonaDefinition, MinorityView, MinorityViewPosition, AgentPersona, Confidence, NarrativeChainFields } from "@/types/debate";
import type { FundamentalScore } from "@/types/fundamental";
import type { MarketRegimeType } from "@/db/schema/analyst";
import { verifyConsensusLevels } from "./consensusVerifier.js";
import { detectContradictions } from "./contradictionDetector.js";
import { STRUCTURAL_NARRATIVE_MIN_DAYS, SECTOR_ROTATION_MIN_DAYS, THESIS_EXPIRE_PROGRESS } from "./thesisConstants.js";
import { MAX_ACTIVE_THESES_PER_AGENT } from "./thesisStore.js";

const MODERATOR_MAX_TOKENS = 16384;

interface Round3Input {
  provider: LLMProvider;
  moderator: PersonaDefinition;
  round1Outputs: RoundOutput[];
  round2Outputs: RoundOutput[];
  question: string;
  /** 학습 메모리 컨텍스트 — 모더레이터 종합 판단 시 검증된 원칙 참조 (#799) */
  memoryContext?: string;
  /** Original market data for cross-validation */
  marketDataContext?: string;
  /** SEPA 기반 펀더멘탈 스코어 (XML 태그 래핑 텍스트) */
  fundamentalContext?: string;
  /** 에이전트별 적중률 — 합의 가중치 조정용 */
  agentPerformanceContext?: string;
  /** 조기포착 도구 결과 — pre-Phase 2 후보 */
  earlyDetectionContext?: string;
  /** 촉매 데이터 (종목 뉴스, 실적 서프라이즈, 임박 실적 발표) */
  catalystContext?: string;
  /** 서사 체인 + 국면 컨텍스트 (#735) */
  narrativeChainContext?: string;
  /** 기존 ACTIVE/CONFIRMED thesis 컨텍스트 — 의미적 중복 생성 방지 (#764) */
  existingThesesContext?: string;
}

interface Round3Result {
  synthesis: SynthesisResult;
  marketRegime: MarketRegimeRaw | null;
  tokensUsed: { input: number; output: number };
}

/**
 * SEPA 펀더멘탈 스코어 배열을 Round 3 프롬프트용 순수 마크다운 테이블로 변환.
 * XML 래핑은 buildSynthesisPrompt에서 처리한다.
 * 데이터가 없으면 빈 문자열 반환.
 */
export function formatFundamentalContext(scores: FundamentalScore[]): string {
  if (scores.length === 0) return "";

  const formatPercentage = (value: number | null): string => {
    if (value == null) return "—";
    return `${value > 0 ? "+" : ""}${value}%`;
  };

  const rows = scores.map((s) => {
    const epsYoY = formatPercentage(s.criteria.epsGrowth.value);
    const revenueYoY = formatPercentage(s.criteria.revenueGrowth.value);
    const epsAccel = s.criteria.epsAcceleration.passed ? "예" : "아니오";
    const marginExp = s.criteria.marginExpansion.passed ? "예" : "아니오";

    return `| ${s.symbol} | ${s.grade} | ${epsYoY} | ${revenueYoY} | ${epsAccel} | ${marginExp} |`;
  });

  return [
    "| 종목 | 등급 | EPS YoY | 매출 YoY | EPS 가속 | 마진 확대 |",
    "|------|------|---------|---------|---------|---------|",
    ...rows,
    "",
    "※ 등급 기준: S(Top 3 of A) > A > B > C > F",
    "※ B등급 미만 종목을 추천할 경우 \"펀더멘탈 미검증\" 표기 필수",
  ].join("\n");
}

/**
 * regimeStore.ts의 ALLOWED_TRANSITIONS(Set)를 프롬프트용 문자열 배열로 변환.
 * 단일 진실 공급원(SSOT)을 유지하여 전환 규칙 불일치를 방지.
 */
const ALLOWED_TRANSITIONS_TEXT: Readonly<Record<MarketRegimeType, readonly string[]>> =
  Object.fromEntries(
    Object.entries(ALLOWED_TRANSITIONS).map(([from, toSet]) => [from, Array.from(toSet)]),
  ) as unknown as Record<MarketRegimeType, readonly string[]>;

/**
 * 이전 확정 레짐 정보를 프롬프트용 텍스트로 포매팅.
 * - regime이 null이면 "확정된 레짐 없음 — 제약 없이 판정" 안내.
 * - regime이 있으면 확정 레짐, 경과일수, 허용 전환 경로를 포함.
 *
 * @param regime 최근 확정 레짐 (null이면 초기 상태)
 * @param today YYYY-MM-DD 형식의 오늘 날짜
 */
export function formatRegimeContext(regime: MarketRegimeRow | null, today: string): string {
  if (regime == null) {
    return [
      "### 이전 확정 레짐",
      "현재 확정된 레짐이 없습니다 (초기 상태). 제약 없이 판정하세요.",
    ].join("\n");
  }

  const confirmedDate = new Date(`${regime.regimeDate}T00:00:00Z`);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const daysSince = Math.floor((todayDate.getTime() - confirmedDate.getTime()) / (1000 * 60 * 60 * 24));

  const allowed = ALLOWED_TRANSITIONS_TEXT[regime.regime];
  const transitionTable = Object.entries(ALLOWED_TRANSITIONS_TEXT)
    .map(([from, to]) => `  ${from} → ${(to as readonly string[]).join(" / ")}`)
    .join("\n");

  return [
    "### 이전 확정 레짐",
    `- **현재 확정 레짐**: ${regime.regime} (${regime.regimeDate} 확정, ${daysSince}일 경과)`,
    `- **허용 전환 경로**: ${regime.regime} → ${allowed.join(" / ")}`,
    `- 위 경로 외의 전환(예: EARLY_BEAR → LATE_BULL)은 **금지**입니다.`,
    `- 급격한 전환이 필요하다면, rationale에 **명시적 근거**를 반드시 포함하세요.`,
    "",
    "**전체 허용 전환 매트릭스:**",
    transitionTable,
  ].join("\n");
}

export function buildSynthesisPrompt(
  round1Outputs: RoundOutput[],
  round2Outputs: RoundOutput[],
  question: string,
  marketDataContext?: string,
  fundamentalContext?: string,
  agentPerformanceContext?: string,
  earlyDetectionContext?: string,
  catalystContext?: string,
  regimeContext?: string,
  narrativeChainContext?: string,
  existingThesesContext?: string,
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

  const fundamentalSection = fundamentalContext != null && fundamentalContext.length > 0
    ? [
        "\n---\n",
        "<fundamental-data>",
        "## 추천 종목 펀더멘탈 데이터",
        "",
        "아래는 Phase 2 진입 종목들의 SEPA 기반 펀더멘탈 스코어입니다.",
        "섹션 4(기회: 주도섹터/주도주) 작성 시 이 데이터를 반드시 참조하세요.",
        "",
        fundamentalContext,
        "</fundamental-data>",
      ].join("\n")
    : "";

  const earlyDetectionSection = earlyDetectionContext != null && earlyDetectionContext.length > 0
    ? [
        "\n---\n",
        "<early-detection>",
        "## 조기포착 후보 (pre-Phase 2)",
        "",
        "아래는 아직 Phase 2에 진입하지 않았으나, 조기 전환 신호가 감지된 종목입니다.",
        "섹션 4(기회: 주도섹터/주도주)에서 별도 카테고리(\"조기포착 후보\")로 분리하여 기재하세요.",
        "전문가가 언급하지 않은 조기포착 종목도 위 데이터를 직접 참조하여 Phase 2 전환 가능성을 평가하세요.",
        "",
        earlyDetectionContext,
        "</early-detection>",
      ].join("\n")
    : "";

  const catalystSection = catalystContext != null && catalystContext.length > 0
    ? [
        "\n---\n",
        "<catalyst-data>",
        "## 촉매 데이터 (뉴스/실적)",
        "",
        "아래는 Phase 2 종목의 최근 뉴스, 섹터별 실적 서프라이즈 비트율, 임박한 실적 발표 일정입니다.",
        "섹션 3(핵심 발견)과 섹션 4(기회: 주도섹터/주도주)에서 \"왜 지금 이 섹터인지\" 설명할 때 촉매 근거로 활용하세요.",
        "섹션 7(이벤트 캘린더)에 임박한 실적 발표 일정을 반영하세요.",
        "",
        catalystContext,
        "</catalyst-data>",
      ].join("\n")
    : "";

  const narrativeChainSection = narrativeChainContext != null && narrativeChainContext.length > 0
    ? [
        "\n---\n",
        "<narrative-chains>",
        narrativeChainContext,
        "</narrative-chains>",
      ].join("\n")
    : "";

  const performanceSection = agentPerformanceContext != null && agentPerformanceContext.length > 0
    ? `\n---\n\n${agentPerformanceContext}\n`
    : "";

  const existingThesesSection = existingThesesContext != null && existingThesesContext.length > 0
    ? [
        "\n---\n",
        "<existing-theses trust=\"internal\">",
        "## 기존 ACTIVE/CONFIRMED Thesis (최근 7일)",
        "",
        "아래는 현재 유효한 기존 thesis입니다. **중복 생성 방지를 위해 반드시 참조하세요.**",
        "",
        "**규칙:**",
        "1. 기존 thesis와 **주제·방향이 동일한** thesis는 새로 생성하지 마세요.",
        "   - 동일 판단 기준: 같은 서사(예: 호르무즈 봉쇄 → 에너지 수혜)를 같은 방향으로 반복하는 경우",
        "   - 비동일 예시: 같은 섹터라도 다른 동인(예: 호르무즈 봉쇄 vs 사우디 감산)이면 별개 thesis",
        "2. 기존 thesis의 근거가 **강화되었거나 새로운 데이터가 추가된 경우**, 리포트 본문에서 언급하되 별도 thesis로 추출하지 마세요.",
        "3. 기존 thesis와 **상충하는 새로운 근거**가 발견된 경우에만 반대 방향 thesis를 새로 생성할 수 있습니다.",
        "",
        existingThesesContext.replace(/<\/existing-theses>/gi, "[/existing-theses]"),
        "</existing-theses>",
      ].join("\n")
    : "";

  return `## 시장 분석 종합 요청

### 질문
${question}
${dataSection}
${fundamentalSection}
${earlyDetectionSection}
${catalystSection}
${narrativeChainSection}
${existingThesesSection}
${performanceSection}
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
  - N+1 병목 예측: 애널리스트들의 예측을 종합하여 다음 주목할 공급 체인 노드를 서사로 기술
    (2명 이상 동일 지점 → 아래 JSON의 nextBottleneck 필드에도 기록, 3명 이상 → "강한 예측"으로 표기)
  - **[가드레일] N+1 병목 작성 시 정량 근거(CAPEX 규모, 리드타임 단축 수치, 재고 증가율 등) 1개 이상 필수. 정량 근거 없으면 nextBottleneck은 null로 기록.**
- **[가드레일] VIX 해석**: VIX 단기 하락만으로 심리 전환 결론 금지. VIX 20 하회 + 3거래일 이상 지속이 확인된 경우에만 "심리 전환" 언급 가능. 미충족 시 "VIX 추세 모니터링 중" 표기.

### 4. 기회: 주도섹터/주도주 (가장 중요한 섹션)
우리의 목표는 **상승 초입에 진입 중인 섹터와 종목을 남들보다 먼저 포착**하는 것입니다.

아래 테이블 형식으로 정리한 뒤, 각 항목에 대해 서사를 보충하세요:

| 섹터/종목 | 근거 | 상태 |
|----------|------|------|

- **왜 지금 이 섹터인지** — 촉매, 자금 흐름, 펀더멘털 변화 근거
- 관련 ETF 티커와 대표 종목 티커
- 종목의 **현재 모멘텀 상태** 필수: 5일/20일 가격 변화율이 마이너스면 "고점 피로감 경계" 표기

※ **[가드레일] 트레이딩 시그널 금지**: 진입가, 매매 타이밍, 손절 수준을 언급하는 문장은 전체 삭제. 우리는 단기 매매가 아니라 **구조적 변화의 초기 신호를 포착**하는 것이 목표입니다.
※ **[가드레일] 펀더멘탈 필터**: 위 펀더멘탈 데이터에서 B등급 미만(C, F) 종목을 추천할 경우 해당 종목 옆에 반드시 "(펀더멘탈 미검증)" 표기 필수.
※ **[가드레일] 테마 격상 기준**: 동일 섹터 3종목 이상이 동반 상승 전환을 확인한 경우에만 "구조적 발견" 또는 "주도 테마"로 격상 가능. 단일 종목 또는 2종목 이하로 테마 서사를 작성하지 마세요.
※ **[가드레일] Sector Alpha Gate**: 병목 체인 테이블에서 Alpha Gate가 "구조적 관찰"인 체인의 수혜 섹터/종목은 종목 추천 대상에서 제외하세요. 해당 섹터는 SEPA 기준 알파 포착이 어려운 구조입니다. 거시 분석 참고용으로만 언급하고 "(구조적 관찰)" 태그를 부여하세요.
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
다음 1~2주 내 주요 이벤트를 **날짜 오름차순**으로 마크다운 테이블 형식으로 작성하세요:

| 날짜 | 이벤트 | 위 분석에 미치는 영향 |
|------|--------|----------------------|
| YYYY-MM-DD | 이벤트명 | 영향 1줄 |

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
- "Phase 3→2 전환" → **"상승 복귀"** 또는 **"분배 탈출"** (긍정적 전환이므로 "붕괴", "악화"로 표현 금지)
- "Phase 2→3 전환" → **"분배 진입"** 또는 **"과열 경고"**
- "Phase 3→4 전환" → **"하락 전환"** 또는 **"약세 확인"**
- "Phase 2→1 전환" → **"추세 이탈"** 또는 **"상승 실패"**
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

**카테고리 분류 기준 (2개만 사용 — short_term_outlook은 폐지됨):**
- \`structural_narrative\`: 수요-공급-병목 서사 기반 전망. timeframe 60~90일. 구조적 변화의 중장기 방향성.
- \`sector_rotation\`: 섹터 로테이션 전망. timeframe 45~90일. 자금 흐름과 섹터 순환 중기 방향성.
- **short_term_outlook 카테고리는 사용하지 마세요.** 30일 이하 단기 예측은 시스템에서 차단됩니다.

**thesis 허용 패턴:**
- 구조적 전환 방향성: "risk-off에서 risk-on으로의 전환 초기 신호 감지"
- 조건부 형식: "VIX 30 기준, 25 이하로 안정되면 기술주 반등 가능" (시점이 아닌 조건)
- 레짐 전환 감지: "EARLY_BEAR에서 EARLY_BULL 전환 조건 형성 중"
- tech 구조적 전환: "AI capex 사이클 하드웨어→소프트웨어 전환 가속", "반도체 재고 사이클 저점 통과 신호"

**thesis 금지 패턴:**
- 특정 기한 내 수치 도달 예측: "30일 내 VIX 20 하회"
- 구체적 가격 목표/% 수익률 예측: "SOXX $185 → $208", "60일 내 15-20% 상승"
- 심리/변동성 타이밍 예측: "3주 내 반등 시작"

**에이전트별 카테고리 제한:**
- 모든 에이전트는 \`structural_narrative\` 또는 \`sector_rotation\`만 사용합니다.
- **sentiment** 에이전트의 분석은 포지셔닝 과밀/자금 흐름 구조 관점에서만 thesis화하세요. 방향성 예측(지수 목표치, VIX 하락 예측 등)은 thesis로 추출하지 마세요.

**정량 조건 작성 규칙 (중요 — 자동 검증의 핵심):**
- targetCondition과 invalidationCondition은 **반드시 수치 비교 형식**으로 작성하세요
- 형식: "[지표] [비교연산자] [숫자]" — 비교연산자: >, <, >=, <=
- 지수 예시: "S&P 500 > 5800", "NASDAQ > 18000", "VIX < 20", "Russell 2000 > 2100"
- 섹터 RS 예시: "Technology RS > 60", "Energy RS > 55", "Healthcare RS < 45"
  (형식: "[섹터명] RS [비교연산자] [숫자]" — 섹터명은 DB에 저장된 영문 섹터명 그대로 사용)
- **개별 종목 티커(NVDA, AAPL 등)를 조건에 사용하지 마세요** — 시스템이 종목 가격을 자동 검증할 수 없습니다
  - 잘못된 예: "NVDA > 850", "AAPL > 200" ← 자동 검증 불가, LLM 주관 판정으로 전락
  - 올바른 대안: 해당 종목의 섹터 RS 또는 관련 지수로 변환하세요 (예: "Technology RS > 60", "NASDAQ > 18000")
- 정량 조건이 있으면 시스템이 **자동으로 시장 데이터와 비교 검증**합니다
- 정량 조건이 없거나 지원하지 않는 지표를 쓰면 LLM이 주관적으로 판정하게 되어 검증 신뢰도가 크게 떨어집니다
- **정성적 조건은 수치 비교가 구조적으로 불가능한 경우에만 허용합니다** (예: 규제 발표, 지정학 이벤트)
  - 정성적 조건 허용 예: "반도체 수출 규제 추가 발표", "FOMC 금리 동결 결정"
  - 정성적 조건 불허 예: "AI 반도체 수요 지속", "기술주 실적 호조 유지", "시장 심리 개선" — 이런 조건은 verificationMetric과 함께 수치 형식으로 변환하세요
- **tech 에이전트 전망 주의**: 기술/산업 전망도 반드시 지수 또는 섹터 RS 기반 정량 조건을 포함하세요. 예: "Technology RS > 65", "NASDAQ > 18000". 정량 조건이 없는 tech thesis는 자동 검증이 불가능하여 ACTIVE 상태로 적체되고, 학습 루프(agent_learnings)에 반영되지 않습니다. 검증 불가 thesis는 진행률 ${THESIS_EXPIRE_PROGRESS * 100}% 이상 시 강제 만료됩니다.
- **structural_narrative 해소 조건 필수**: structural_narrative thesis는 구조적 방향성을 다루지만, 반드시 정량적 해소 조건(targetCondition, invalidationCondition)을 수치 비교 형식으로 작성하세요. "AI capex 사이클 전환 가속" 같은 정성적 thesis도 "Technology RS >= 60" 또는 "NASDAQ > 18000" 등 수치로 검증 가능한 조건을 포함해야 합니다. 에이전트당 ACTIVE thesis 상한은 ${MAX_ACTIVE_THESES_PER_AGENT}건이므로, 판정 불가 thesis가 쌓이면 새 thesis 생성 여력이 줄어듭니다.

**verificationMetric 지원 형식:**
- 지수명: "S&P 500", "NASDAQ", "DOW 30", "Russell 2000", "VIX"
- 지수 별칭: "SPX" (S&P 500), "QQQ" (NASDAQ), "IWM" (Russell 2000)
- 섹터 RS: "[섹터명] RS" (예: "Technology RS", "Energy RS", "Healthcare RS", "Financials RS")
- 공포탐욕지수: "fear & greed" 또는 "공포탐욕지수"
- 개별 종목 티커는 지원되지 않으므로 verificationMetric을 지수 또는 섹터 RS로 설정하세요

\`\`\`json
[
  {
    "agentPersona": "macro|tech|geopolitics|sentiment",
    "thesis": "현재 기준값 포함한 구체적 예측 문장",
    "category": "structural_narrative|sector_rotation",
    "timeframeDays": 45|60|90,
    "verificationMetric": "검증에 사용할 지표 (티커 또는 지수명)",
    "targetCondition": "S&P 500 > 5800",
    "invalidationCondition": "S&P 500 < 5500",
    "confidence": "low|medium|high",
    "consensusLevel": "4/4|3/4|2/4|1/4",
    "narrativeChain": {
      "megatrend": "AI 인프라 확장",
      "demandDriver": "AI 모델 파라미터 증가 → 데이터센터 전력 수요 급증",
      "supplyChain": "전력 변압기 → 냉각 시스템 → 광트랜시버",
      "bottleneck": "광트랜시버 대역폭 제한 (800G→1.6T 전환 지연)"
    },
    "beneficiarySectors": ["Communication Equipment", "Fiber Optics"],
    "beneficiaryTickers": ["CIEN", "LITE", "AAOI"],
    "nextBottleneck": "데이터센터 전력 공급·냉각",
    "nextBeneficiarySectors": ["Utilities", "Power Infrastructure"],
    "nextBeneficiaryTickers": ["AES", "NEE", "VST"],
    "dissentReason": "지정학 분석가: 공급 체인 재편 속도 과대평가 우려",
    "minorityView": { "analyst": "geopolitics", "position": "bearish", "reasoning": "공급 체인 재편 속도 과대평가 — 실제 리드타임 6개월 이상 소요 가능" }
  }
]
\`\`\`

**nextBottleneck 작성 규칙 (강화):**
- structural_narrative 카테고리에만 작성.
- 라운드 1·2에서 2명 이상이 동일 지점을 언급한 경우에만 작성. 그 외는 null.
- 형식: "공급 체인 노드 + 예상 시점" (예: "HBM 용량 제한 — GPU 병목 해소 후 2~3분기 내")
- 현재 병목이 ACTIVE 초기 단계라면 null (아직 N+1을 논하기 이른 단계)

**narrativeChain 작성 규칙:**
- structural_narrative 카테고리에만 작성. 그 외는 null.
- megatrend: 거시적 동인 1줄 (예: "AI 인프라 확장")
- demandDriver: 수요 원인 1~2줄 (예: "AI 모델 파라미터 증가 → 데이터센터 전력 수요 급증")
- supplyChain: 공급망 경로 화살표(→) 형식 (예: "전력 변압기 → 냉각 시스템 → 광트랜시버")
- bottleneck: 현재 공급 병목 노드 1개만. 여러 개 나열 금지.

**beneficiarySectors / beneficiaryTickers 작성 규칙:**
- structural_narrative 카테고리에만 작성. 그 외 카테고리는 생략하거나 빈 배열.
- beneficiarySectors: **현재 병목**의 수혜를 받는 섹터 (현재 서사의 직접 수혜자, 영문 GICS 기준). 예: ["Communication Equipment", "Fiber Optics"]
- beneficiaryTickers: 현재 병목 수혜 섹터의 대표 종목 (2~5개). 예: ["CIEN", "LITE", "AAOI"]
- nextBeneficiarySectors: N+1 병목이 해소될 때 수혜 섹터 (nextBottleneck과 연동). 예: ["Utilities", "Power Infrastructure"]
- nextBeneficiaryTickers: N+1 수혜 섹터의 대표 종목 (2~5개). 예: ["AES", "NEE", "VST"]
- 서사적으로 수혜가 명확한 종목이면 현재 Phase 및 섹션 4 언급 여부와 무관하게 모두 포함.
- 근거 없는 추측 금지. 공급 체인 논리로 연결 가능한 종목만 기입.

**dissentReason 작성 규칙:**
- 합의되지 않은 의견이 있을 경우 \`dissentReason\`에 반대 입장 1~2줄 요약. 만장일치면 null.

**minorityView 작성 규칙 (소수 의견 보존):**
- 다수 의견과 다른 입장을 취한 애널리스트가 있으면 \`minorityView\` 객체를 작성.
- 만장일치(consensusLevel "4/4")이면 null.
- 형식: \`{ "analyst": "persona", "position": "bearish|bullish|neutral", "reasoning": "1~2줄 근거" }\`
- 예시: \`{ "analyst": "geopolitics", "position": "bearish", "reasoning": "중동 리스크 과소평가 — 공급 체인 재편 지연 가능성" }\`
- 소수 의견은 사후 검증 대상이므로 구체적 근거를 반드시 포함.

## 시장 레짐 판정 (JSON)

리포트 마지막에 아래 JSON 블록을 **별도의 코드블록**으로 추가하세요.
이 데이터는 시스템이 자동 파싱합니다.

${regimeContext != null && regimeContext.length > 0 ? regimeContext + "\n\n" : ""}레짐 분류 기준:
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
const VALID_TIMEFRAMES = new Set<number>([45, 60, 90]);
const VALID_CATEGORIES = new Set<string>([
  "structural_narrative",
  "sector_rotation",
]);

/**
 * 페르소나별 허용 카테고리 맵.
 * 맵에 없는 페르소나는 모든 카테고리 허용.
 * #845: short_term_outlook 완전 제거. 모든 에이전트가 structural_narrative + sector_rotation만 사용.
 * 이 맵은 defense-in-depth로 유지 — 향후 카테고리 추가 시 페르소나별 제한 가능.
 */
const ALLOWED_CATEGORIES_PER_PERSONA: Partial<Record<AgentPersona, Set<ThesisCategory>>> = {
  sentiment: new Set<ThesisCategory>(["structural_narrative", "sector_rotation"]),
  macro: new Set<ThesisCategory>(["structural_narrative", "sector_rotation"]),
  geopolitics: new Set<ThesisCategory>(["structural_narrative", "sector_rotation"]),
};

/**
 * narrativeChain 필드를 정규화.
 * 4개 문자열 필드가 모두 존재하면 반환, 그 외 null.
 */
function normalizeNarrativeChain(raw: unknown): NarrativeChainFields | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (
    typeof obj.megatrend !== "string" || obj.megatrend.length === 0 ||
    typeof obj.demandDriver !== "string" ||
    typeof obj.supplyChain !== "string" ||
    typeof obj.bottleneck !== "string" || obj.bottleneck.length === 0
  ) {
    return null;
  }

  return {
    megatrend: obj.megatrend,
    demandDriver: obj.demandDriver,
    supplyChain: obj.supplyChain,
    bottleneck: obj.bottleneck,
  };
}

/**
 * minorityView 필드를 정규화.
 * 유효한 객체면 wasCorrect: null을 보장, 그 외 null 반환.
 */
const VALID_POSITIONS = new Set<MinorityViewPosition>(["bearish", "bullish", "neutral"]);

function normalizeMinorityView(raw: unknown): MinorityView | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (
    !VALID_PERSONAS.has(obj.analyst as string) ||
    typeof obj.position !== "string" ||
    !VALID_POSITIONS.has(obj.position as MinorityViewPosition) ||
    typeof obj.reasoning !== "string" ||
    obj.reasoning.length === 0
  ) {
    return null;
  }

  return {
    analyst: obj.analyst as AgentPersona,
    position: obj.position as MinorityViewPosition,
    reasoning: obj.reasoning,
    wasCorrect: null, // 사후 검증 시 업데이트
  };
}

/**
 * sentiment 에이전트의 confidence를 2단계 하향한다.
 * 적중률 41% 반영 — high→low, medium→low, low는 유지.
 * #620: 1단계(high→medium)에서 2단계로 강화. 41% 적중률은 low 수준.
 */
const CONFIDENCE_DOWNGRADE: Record<string, Confidence> = {
  high: "low",
  medium: "low",
  low: "low",
};

/**
 * confidence 자동 하향 대상 페르소나.
 * 전체 적중률 50% 미만 에이전트를 등록한다.
 * macro(60%), geopolitics(62.5%)는 전체 적중률이 50% 이상이므로 대상 아님.
 * 이들은 카테고리 차단(ALLOWED_CATEGORIES_PER_PERSONA)으로 short_term_outlook만 억제.
 * #620→#687: sentiment 적중률 41% — 2단계 하향(high→low, medium→low)으로 강화.
 */
const CONFIDENCE_DOWNGRADE_PERSONAS = new Set<AgentPersona>(["sentiment"]);

/**
 * confidence 하향 면제 카테고리.
 * structural_narrative는 구조적 포지셔닝 관찰(포지셔닝 과밀, 자금 흐름 구조)이므로
 * 방향성 예측이 아닌 구조 분석에 해당하여 confidence 원본을 유지한다.
 * sector_rotation은 방향성 판단 요소가 있어 기존 하향을 유지.
 * #669: 반대론자(contrarian) 역할의 구조적 관찰까지 억제되는 문제 해소.
 */
const CONFIDENCE_DOWNGRADE_EXEMPT_CATEGORIES = new Set<ThesisCategory>(["structural_narrative"]);

// #845: CONFIDENCE_DOWNGRADE_CATEGORIES 제거 — short_term_outlook 카테고리 완전 제거됨.

// #845: containsPriceTarget / filterTechPriceTargets 제거 — short_term_outlook 카테고리 완전 제거됨.
// tech의 가격 목표 thesis 필터는 short_term_outlook 전용이었으므로 더 이상 불필요.

/**
 * sentiment 에이전트의 thesis에 수치 예측 패턴이 포함되어 있는지 검사한다.
 * VIX/F&G/RS 등 지표 + 구체적 수치 + 예측 표현(전망, 도달, 회복, 하회 등) 조합을 검출.
 * 순수 함수 — 테스트 용이.
 * #620: 프롬프트 제약이 무시된 전적이 있으므로 코드 레벨 가드레일로 차단.
 */
const SENTIMENT_NUMERIC_PREDICTION_PATTERNS: RegExp[] = [
  // VIX + 수치 + 예측 표현
  /VIX[^\d]*\d+.*(?:하회|하락|도달|안착|회복|전망|예상|반전|레인지)/,
  /VIX.*(?:하회|하락|도달|안착|회복|전망|예상|반전)\s*.*\d+/,
  // Fear & Greed / F&G + 수치 + 예측 표현
  /(?:F&G|Fear\s*(?:&|and)\s*Greed|공포\s*탐욕)[^\d]*\d+.*(?:회복|도달|상승|하락|전망|예상|반전)/,
  /(?:F&G|Fear\s*(?:&|and)\s*Greed|공포\s*탐욕).*(?:회복|도달|상승|하락|전망|예상|반전)\s*.*\d+/,
  // RS + 수치 + 예측 표현
  /RS[^\d]*\d+.*(?:하회|하락|도달|상승|회복|돌파|전망|예상)/,
  /RS.*(?:하회|하락|도달|상승|회복|돌파|전망|예상)\s*.*\d+/,
  // N주/N일 내 반전/도달 패턴
  /\d+\s*(?:주|일|개월|week|day|month)\s*(?:내|이내|안에).*(?:반전|도달|회복|하락|상승|안착)/i,
  // 바닥/고점 형성 후 반등/하락
  /(?:바닥|저점|고점)\s*(?:형성|확인).*(?:후|이후).*(?:반등|반전|회복|하락)/i,
];

export function containsNumericPrediction(thesis: string): boolean {
  return SENTIMENT_NUMERIC_PREDICTION_PATTERNS.some((pattern) => pattern.test(thesis));
}

/**
 * sentiment 에이전트의 thesis에 추세 반전(mean-reversion) 예측 패턴이 포함되어 있는지 검사한다.
 * 추세 반전 예측은 base rate가 낮은 이벤트이므로 HIGH confidence와 양립할 수 없다.
 * 순수 함수 — 테스트 용이.
 * #731: HIGH confidence 적중률 33.3%로 역전 — mean-reversion 예측에 HIGH 부여가 원인.
 */
const SENTIMENT_MEAN_REVERSION_PATTERNS: RegExp[] = [
  // 추세/국면/방향 반전·전환 예측
  /(?:추세|국면|방향|흐름)\s*(?:반전|전환)/,
  // 정상화/안정화 예측
  /(?:정상화|안정화)\s*(?:전망|예상|예측|진입|시작|완료|임박)/,
  // 심리 상태 전환 예측 (공포→중립, risk-off→risk-on 등)
  /(?:공포|탐욕|과열|과매도|risk-off|risk-on)\s*(?:→|->)\s*(?:중립|정상|안정|탐욕|공포|risk-on|risk-off)/i,
  // 회복/반등 직접 전망 (구조적 관찰 "회복 중"은 제외, 전망만 포착)
  /(?:회복|반등)\s*(?:전망|예상|예측|완료|임박)/,
  // 조정 마무리/완료 예측
  /조정\s*(?:마무리|완료|종료|끝|일단락)/,
  // 바닥/저점 형성 판단
  /(?:바닥|저점)\s*(?:형성|확인|통과|완료|도달)/,
  // 전환 완료/임박 예측
  /전환\s*(?:완료|임박|예상|전망)/,
  // 매도/하락/공포 소진 후 반등 패턴
  /(?:매도|하락|공포)\s*(?:소진|피로).*(?:반등|회복|전환)/,
];

export function containsMeanReversionPattern(thesis: string): boolean {
  return SENTIMENT_MEAN_REVERSION_PATTERNS.some((pattern) => pattern.test(thesis));
}

// #845: filterShortTermOutlookCap 제거 — short_term_outlook 카테고리 완전 제거됨.

/**
 * sentiment 에이전트의 수치 예측 thesis를 필터링(드롭)한다.
 * sentiment 이외 에이전트의 thesis는 통과.
 * #620: 프롬프트 제약이 무시된 전적 — 코드 레벨 가드레일.
 */
function filterNumericPredictions(theses: Thesis[]): Thesis[] {
  return theses.filter((t) => {
    if (t.agentPersona !== "sentiment") return true;
    if (containsNumericPrediction(t.thesis)) {
      logger.info(
        "Round3",
        `sentiment의 수치 예측 thesis 드롭: "${t.thesis.slice(0, 60)}..." (#620 가드레일)`,
      );
      return false;
    }
    return true;
  });
}

/**
 * thesis 객체의 optional/category 필드를 정규화.
 * 순수 함수 — 원본을 변경하지 않고 새 객체를 반환.
 */
function normalizeThesisFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  let category: ThesisCategory =
    obj.category == null || !VALID_CATEGORIES.has(obj.category as string)
      ? ("sector_rotation" satisfies ThesisCategory)
      : (obj.category as ThesisCategory);

  // 페르소나별 허용 카테고리 강제 적용
  const persona = obj.agentPersona as AgentPersona | undefined;
  if (persona != null) {
    const allowed = ALLOWED_CATEGORIES_PER_PERSONA[persona];
    if (allowed != null && !allowed.has(category)) {
      const fallback = allowed.values().next().value as ThesisCategory;
      logger.info(
        "Round3",
        `${persona}의 thesis 카테고리 재분류: ${category} → ${fallback} (허용: ${[...allowed].join(", ")})`,
      );
      category = fallback;
    }
  }

  // 저적중 에이전트 confidence 자동 하향
  // #669: structural_narrative는 구조적 관찰이므로 하향 면제 (반대론자 역할 보전)
  let confidence = (obj.confidence as string) ?? "low";
  if (
    persona != null &&
    CONFIDENCE_DOWNGRADE_PERSONAS.has(persona) &&
    VALID_CONFIDENCE.has(confidence) &&
    !CONFIDENCE_DOWNGRADE_EXEMPT_CATEGORIES.has(category)
  ) {
    const downgraded = CONFIDENCE_DOWNGRADE[confidence];
    if (downgraded != null && downgraded !== confidence) {
      logger.info(
        "Round3",
        `${persona}의 thesis confidence 하향: ${confidence} → ${downgraded} (적중률 보정)`,
      );
      confidence = downgraded;
    }
  }

  // sentiment의 structural_narrative mean-reversion 예측 confidence 캡 (#731)
  // HIGH confidence 적중률 33.3%로 역전 — mean-reversion 패턴 감지 시 MEDIUM으로 캡.
  // structural_narrative가 아닌 카테고리는 위 CONFIDENCE_DOWNGRADE에서 이미 low로 하향됨.
  if (
    persona === "sentiment" &&
    category === "structural_narrative" &&
    confidence === "high" &&
    typeof obj.thesis === "string" &&
    containsMeanReversionPattern(obj.thesis as string)
  ) {
    logger.info(
      "Round3",
      `sentiment의 structural_narrative mean-reversion thesis confidence 캡: high → medium (#731 가드레일)`,
    );
    confidence = "medium";
  }

  // #845: 카테고리별 confidence 하향 제거 — short_term_outlook 카테고리 완전 제거됨.

  // #845: 카테고리별 최소 timeframe 적용
  let timeframeDays = obj.timeframeDays as number;
  const minDays = category === "structural_narrative"
    ? STRUCTURAL_NARRATIVE_MIN_DAYS
    : SECTOR_ROTATION_MIN_DAYS;
  if (VALID_TIMEFRAMES.has(timeframeDays) && timeframeDays < minDays) {
    logger.info(
      "Round3",
      `${category} thesis timeframe 상향: ${timeframeDays}일 → ${minDays}일 (최소 하한 적용 #845)`,
    );
    timeframeDays = minDays;
  }

  const narrativeChain = normalizeNarrativeChain(obj.narrativeChain);

  return {
    ...obj,
    category,
    confidence,
    timeframeDays,
    nextBottleneck: obj.nextBottleneck ?? null,
    dissentReason: obj.dissentReason ?? null,
    beneficiarySectors: Array.isArray(obj.beneficiarySectors) ? obj.beneficiarySectors : [],
    beneficiaryTickers: Array.isArray(obj.beneficiaryTickers) ? obj.beneficiaryTickers : [],
    nextBeneficiarySectors: Array.isArray(obj.nextBeneficiarySectors) ? obj.nextBeneficiarySectors : [],
    nextBeneficiaryTickers: Array.isArray(obj.nextBeneficiaryTickers) ? obj.nextBeneficiaryTickers : [],
    narrativeChain,
    minorityView: normalizeMinorityView(obj.minorityView),
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
    return { theses: applyThesisFilters(validated), cleanReport };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("Round3", `Failed to parse thesis JSON: ${msg}`);
    return { theses: [], cleanReport };
  }
}

/**
 * 공통 thesis 필터 파이프라인.
 * extractThesesFromText / extractDebateOutput 양쪽에서 동일한 필터를 적용한다.
 * #845: filterTechPriceTargets, filterShortTermOutlookCap 제거 (short_term_outlook 완전 제거).
 */
function applyThesisFilters(theses: Thesis[]): Thesis[] {
  return filterNumericPredictions(theses);
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
      return applyThesisFilters(validated);
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
  const { provider, moderator, round1Outputs, round2Outputs, question, memoryContext = "", marketDataContext, fundamentalContext, agentPerformanceContext, earlyDetectionContext, catalystContext, narrativeChainContext, existingThesesContext } = input;

  // 이전 확정 레짐을 조회하여 프롬프트에 주입 — LLM이 맥락 없이 판정하는 것을 방지
  const confirmedRegime = await loadConfirmedRegime();
  const today = new Date().toISOString().slice(0, 10);
  const regimeContext = formatRegimeContext(confirmedRegime, today);

  const userMessage = buildSynthesisPrompt(round1Outputs, round2Outputs, question, marketDataContext, fundamentalContext, agentPerformanceContext, earlyDetectionContext, catalystContext, regimeContext, narrativeChainContext, existingThesesContext);
  let systemPrompt = moderator.systemPrompt;
  if (memoryContext.length > 0) {
    systemPrompt += `\n\n## 장기 기억 (검증된 원칙)\n${memoryContext}`;
  }
  const result = await provider.call({
    systemPrompt,
    userMessage,
    maxTokens: MODERATOR_MAX_TOKENS,
  });

  const { theses, cleanReport, marketRegime } = extractDebateOutput(result.content);
  logger.info("Round3", `Synthesis complete: ${theses.length} theses extracted`);

  // #713: Round 1 에이전트 출력 기반 consensus 알고리즘 검증
  const { theses: verifiedTheses, verificationRan } = verifyConsensusLevels(theses, round1Outputs);
  if (verificationRan) {
    const unverifiedCount = verifiedTheses.filter((t) => t.consensusUnverified === true).length;
    if (unverifiedCount > 0) {
      logger.warn("Round3", `Consensus 불일치 thesis ${unverifiedCount}건 감지 (총 ${verifiedTheses.length}건)`);
    }
  } else {
    logger.warn("Round3", "Consensus 검증 스킵됨 — Round 1 에이전트 수 부족");
  }

  // #752: Cross-thesis 모순 탐지 — 같은 target entity에 상반 방향 thesis flagging
  const { theses: coherenceCheckedTheses, contradictions } = detectContradictions(verifiedTheses);
  if (contradictions.length > 0) {
    logger.warn("Round3", `Cross-thesis 모순 ${contradictions.length}쌍 탐지 (총 ${coherenceCheckedTheses.length}건)`);
  }

  return {
    synthesis: {
      report: cleanReport,
      theses: coherenceCheckedTheses,
    },
    marketRegime,
    tokensUsed: result.tokensUsed,
  };
}
