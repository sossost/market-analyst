import type { LLMProvider } from "./llm/index.js";
import { logger } from "@/lib/logger";
import type { RoundOutput, SynthesisResult, Thesis, ThesisCategory, MarketRegimeRaw, PersonaDefinition, MinorityView, MinorityViewPosition, AgentPersona, Confidence, NarrativeChainFields } from "@/types/debate";
import type { FundamentalScore } from "@/types/fundamental";

const MODERATOR_MAX_TOKENS = 8192;

interface Round3Input {
  provider: LLMProvider;
  moderator: PersonaDefinition;
  round1Outputs: RoundOutput[];
  round2Outputs: RoundOutput[];
  question: string;
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

export function buildSynthesisPrompt(
  round1Outputs: RoundOutput[],
  round2Outputs: RoundOutput[],
  question: string,
  marketDataContext?: string,
  fundamentalContext?: string,
  agentPerformanceContext?: string,
  earlyDetectionContext?: string,
  catalystContext?: string,
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

  const performanceSection = agentPerformanceContext != null && agentPerformanceContext.length > 0
    ? `\n---\n\n${agentPerformanceContext}\n`
    : "";

  return `## 시장 분석 종합 요청

### 질문
${question}
${dataSection}
${fundamentalSection}
${earlyDetectionSection}
${catalystSection}
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

**short_term_outlook 범위 제한 (중요 — 적중률 41.7%, 역신호 수준):**
- 이 카테고리는 시장 심리/변동성의 **타이밍 예측**에서 체계적으로 실패합니다 (14건 INVALIDATED vs 10건 CONFIRMED).
- **시스템 강제 규칙**: 이 카테고리의 confidence는 자동으로 \`low\`로 다운그레이드됩니다. 세션당 최대 1건만 저장됩니다.
- 아래 규칙을 반드시 준수하세요:

- **금지 패턴 (thesis로 추출하지 마세요):**
  - 특정 기한 내 수치 도달 예측: "30일 내 VIX 20 하회", "2주 내 공포탐욕지수 25 회복"
  - 심리/변동성 지표의 절대 수준 예측: "VIX 20 이하 진입", "공포탐욕지수 25 이상 회복"
  - 단기 가격 반등/하락 타이밍 예측: "상승 전환 비율 35% 돌파", "3주 내 반등 시작"
  - 핵심: **"언제까지 X가 Y에 도달"** 형식은 전부 금지

- **허용 패턴 (이런 형식만 thesis로 추출하세요):**
  - 구조적 전환 방향성: "risk-off에서 risk-on으로의 전환 초기 신호 감지"
  - 조건부 형식: "VIX 30 기준, 25 이하로 안정되면 기술주 반등 가능" (시점이 아닌 조건)
  - 레짐 전환 감지: "EARLY_BEAR에서 EARLY_BULL 전환 조건 형성 중"
  - 핵심: **"어떤 조건이 충족되면"** 형식으로 작성

**에이전트별 카테고리 제한:**
- **sentiment** 에이전트의 thesis는 \`structural_narrative\` 또는 \`sector_rotation\`만 허용됩니다. sentiment의 방향성 예측(지수 목표치, VIX 하락 예측 등)은 thesis로 추출하지 마세요. sentiment의 분석은 포지셔닝 과밀/자금 흐름 구조 관점에서만 thesis화하세요.
- 위 제한을 위반한 thesis는 시스템에서 자동 재분류됩니다.

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
- **tech 에이전트 전망 주의**: 기술/산업 전망도 반드시 지수 또는 섹터 RS 기반 정량 조건을 포함하세요. 예: "Technology RS > 65", "NASDAQ > 18000". 정량 조건이 없는 tech thesis는 자동 검증이 불가능하여 ACTIVE 상태로 적체되고, 학습 루프(agent_learnings)에 반영되지 않습니다. 검증 불가 thesis는 진행률 80% 초과 시 강제 만료됩니다.

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
    "category": "structural_narrative|sector_rotation|short_term_outlook",
    "timeframeDays": 30|60|90,
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
- 섹션 4의 주도섹터/주도주 분석에서 이미 언급된 종목이 아닌, **아직 Phase 2 미진입이지만 서사적으로 주시할 종목** 우선.
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
 * 페르소나별 허용 카테고리 맵.
 * 맵에 없는 페르소나는 모든 카테고리 허용.
 * short_term_outlook 적중률 39% (EXPIRED 포함 시 28%) — 전 에이전트 방향성 예측 차단.
 * #561: sentiment 차단, #563: macro/geopolitics 확대.
 */
const ALLOWED_CATEGORIES_PER_PERSONA: Partial<Record<AgentPersona, Set<ThesisCategory>>> = {
  sentiment: new Set<ThesisCategory>(["structural_narrative", "sector_rotation"]),
  macro: new Set<ThesisCategory>(["structural_narrative", "sector_rotation"]),
  geopolitics: new Set<ThesisCategory>(["structural_narrative", "sector_rotation"]),
};

const CATEGORY_FALLBACK: Record<ThesisCategory, ThesisCategory> = {
  short_term_outlook: "sector_rotation",
  sector_rotation: "sector_rotation",
  structural_narrative: "structural_narrative",
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
 * 적중률 44% 반영 — high→low, medium→low, low는 유지.
 * #620: 1단계(high→medium)에서 2단계로 강화. 44% 적중률은 low 수준.
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
 * #620: sentiment 적중률 44% — 2단계 하향(high→low, medium→low)으로 강화.
 */
const CONFIDENCE_DOWNGRADE_PERSONAS = new Set<AgentPersona>(["sentiment"]);

/**
 * confidence 자동 하향 대상 카테고리.
 * 적중률 50% 미만 카테고리를 등록한다.
 * #627: short_term_outlook 적중률 41.7% — 전 에이전트 단기 전망 역신호.
 * 해당 카테고리 thesis는 confidence를 강제 low로 다운그레이드.
 *
 * 참고: sentiment/macro/geopolitics는 ALLOWED_CATEGORIES_PER_PERSONA에 의해
 * short_term_outlook이 sector_rotation으로 먼저 재분류되므로 이 가드레일은
 * 실질적으로 tech 에이전트에만 적용된다. sentiment는 별도로
 * CONFIDENCE_DOWNGRADE_PERSONAS에 의해 confidence가 low로 하향된다.
 */
const CONFIDENCE_DOWNGRADE_CATEGORIES = new Set<ThesisCategory>(["short_term_outlook"]);

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
 * short_term_outlook 카테고리 thesis를 1회 추출당 최대 1건으로 제한한다.
 * 2건 이상이면 첫 번째만 유지, 나머지 드롭 + 로그.
 * #627: 적중률 41.7% — 발행량 자체를 억제하여 역신호 노출 최소화.
 * 참고: extractThesesFromText / extractDebateOutput은 debate당 1회 호출되므로
 * 추출당 1건 = 사실상 debate당 1건.
 */
const MAX_SHORT_TERM_OUTLOOK_PER_EXTRACTION = 1;

export function filterShortTermOutlookCap(theses: Thesis[]): Thesis[] {
  let count = 0;
  return theses.filter((t) => {
    if (t.category !== "short_term_outlook") return true;
    count++;
    if (count > MAX_SHORT_TERM_OUTLOOK_PER_EXTRACTION) {
      logger.info(
        "Round3",
        `short_term_outlook thesis 초과 드롭 (${count}/${MAX_SHORT_TERM_OUTLOOK_PER_EXTRACTION}건 제한): "${t.thesis.slice(0, 60)}..." (#627 가드레일)`,
      );
      return false;
    }
    return true;
  });
}

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
      ? ("short_term_outlook" satisfies ThesisCategory)
      : (obj.category as ThesisCategory);

  // 페르소나별 허용 카테고리 강제 적용
  const persona = obj.agentPersona as AgentPersona | undefined;
  if (persona != null) {
    const allowed = ALLOWED_CATEGORIES_PER_PERSONA[persona];
    if (allowed != null && !allowed.has(category)) {
      const fallback = CATEGORY_FALLBACK[category];
      logger.info(
        "Round3",
        `${persona}의 thesis 카테고리 재분류: ${category} → ${fallback} (허용: ${[...allowed].join(", ")})`,
      );
      category = fallback;
    }
  }

  // 저적중 에이전트 confidence 자동 하향
  let confidence = (obj.confidence as string) ?? "low";
  if (
    persona != null &&
    CONFIDENCE_DOWNGRADE_PERSONAS.has(persona) &&
    VALID_CONFIDENCE.has(confidence)
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

  // 저적중 카테고리 confidence 자동 하향 (#627)
  if (
    CONFIDENCE_DOWNGRADE_CATEGORIES.has(category) &&
    VALID_CONFIDENCE.has(confidence) &&
    confidence !== "low"
  ) {
    logger.info(
      "Round3",
      `${category} 카테고리 thesis confidence 하향: ${confidence} → low (카테고리 적중률 보정 #627)`,
    );
    confidence = "low";
  }

  const narrativeChain = normalizeNarrativeChain(obj.narrativeChain);

  return {
    ...obj,
    category,
    confidence,
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
    const filtered = filterNumericPredictions(validated);
    const capped = filterShortTermOutlookCap(filtered);
    return { theses: capped, cleanReport };
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
      const filtered = filterNumericPredictions(validated);
      return filterShortTermOutlookCap(filtered);
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
  const { provider, moderator, round1Outputs, round2Outputs, question, marketDataContext, fundamentalContext, agentPerformanceContext, earlyDetectionContext, catalystContext } = input;

  const userMessage = buildSynthesisPrompt(round1Outputs, round2Outputs, question, marketDataContext, fundamentalContext, agentPerformanceContext, earlyDetectionContext, catalystContext);
  const result = await provider.call({
    systemPrompt: moderator.systemPrompt,
    userMessage,
    maxTokens: MODERATOR_MAX_TOKENS,
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
