# Corporate Analyst — Phase A 구현 플랜

## 선행 맥락

기존 `fundamental/runFundamentalValidation.ts`에서 S등급 종목에 대해 LLM 분석 + Discord 발행을 수행한다.
이 흐름과 `reviewAgent.ts`의 리뷰 파이프라인 패턴을 참고하되, Phase A의 목적은 Discord 발행이 아니라
**DB 저장 후 대시보드 디테일 페이지에 연결**하는 것이다.

추천 디테일 페이지(`/recommendations/[id]`)는 이미 구현되어 있으며(`RecommendationDetail.tsx`),
현재 `reason` 텍스트 한 줄만 표시한다. 기획서 저장 리포트를 이 페이지에 추가 섹션으로 붙이는 구조.

## 골 정렬

**ALIGNED** — Phase 2 초입 주도주 포착의 핵심은 "왜 이 종목인가"를 빠르고 정확하게 판단하는 것.
기술적+펀더멘탈+섹터 컨텍스트를 통합한 심층 리포트는 추천의 신뢰도와 판단 속도를 모두 높인다.

## 문제

추천 종목의 `reason` 컬럼은 LLM이 생성한 한 줄 메모에 불과하다.
DB에는 이미 섹터 RS, Phase, 4분기 실적, 밸류에이션, 토론 synthesis까지 모든 데이터가 있으나,
이를 종합한 구조화된 분석이 존재하지 않는다.

## Before → After

**Before**: 추천 디테일 페이지에 진입가/수익률/Phase 같은 raw 데이터와 한 줄 `reason`만 표시.
분석가가 "왜 이 종목인가"를 파악하려면 섹터 RS, 실적 트렌드, 밸류에이션을 각각 조회해야 한다.

**After**: 추천 생성 시 에이전트가 자동으로 심층 분석 리포트를 생성·저장한다.
디테일 페이지에 "기업 분석 리포트" 섹션이 추가되어, 투자 포인트 요약부터 리스크까지 한 화면에서 확인 가능.

## 변경 사항

### 백엔드

1. **DB 스키마**: `stock_analysis_reports` 테이블 신규 추가 (`src/db/schema/analyst.ts`)
2. **데이터 로더**: `src/agent/corporateAnalyst/loadAnalysisInputs.ts` — 종목별 분석 입력 데이터 수집
3. **에이전트 코어**: `src/agent/corporateAnalyst/corporateAnalyst.ts` — LLM 분석 실행 + 리포트 생성
4. **실행 진입점**: `src/agent/corporateAnalyst/runCorporateAnalyst.ts` — 외부에서 호출 가능한 함수
5. **트리거 연결**: `src/agent/tools/saveRecommendations.ts` — 추천 저장 성공 후 에이전트 비동기 호출

### 프론트엔드

6. **Supabase 쿼리 확장**: `frontend/src/features/recommendations/lib/supabase-queries.ts` — 리포트 조회 추가
7. **리포트 컴포넌트**: `frontend/src/features/recommendations/components/AnalysisReportCard.tsx` — 리포트 렌더링
8. **디테일 페이지 연결**: `frontend/src/features/recommendations/components/RecommendationDetail.tsx` — 리포트 섹션 추가

## DB 스키마 설계

`src/db/schema/analyst.ts`에 추가:

```typescript
/**
 * stock_analysis_reports — 기업 애널리스트 에이전트 생성 심층 리포트.
 * 신규 추천 시 자동 생성. (symbol, recommendation_date) 기준 UNIQUE.
 */
export const stockAnalysisReports = pgTable(
  "stock_analysis_reports",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    recommendationDate: text("recommendation_date").notNull(), // YYYY-MM-DD

    // 리포트 섹션 (각 섹션은 Markdown 텍스트)
    investmentSummary: text("investment_summary").notNull(),    // 투자 포인트 요약
    technicalAnalysis: text("technical_analysis").notNull(),   // 기술적 분석
    fundamentalTrend: text("fundamental_trend").notNull(),     // 4분기 실적 트렌드
    valuationAnalysis: text("valuation_analysis").notNull(),   // 밸류에이션 멀티플
    sectorPositioning: text("sector_positioning").notNull(),   // 섹터·업종 포지셔닝
    marketContext: text("market_context").notNull(),           // 시장 맥락 (synthesis 활용)
    riskFactors: text("risk_factors").notNull(),               // 리스크 + 모니터링 포인트

    // 메타데이터
    modelUsed: text("model_used").notNull(),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: unique("uq_stock_analysis_reports_symbol_date").on(
      t.symbol,
      t.recommendationDate,
    ),
    idxSymbol: index("idx_stock_analysis_reports_symbol").on(t.symbol),
    idxDate: index("idx_stock_analysis_reports_date").on(t.recommendationDate),
  }),
);
```

**설계 결정:**
- 섹션을 별도 컬럼으로 분리. 단일 `fullReport: text` 대신 섹션별 컬럼을 선택한 이유:
  프론트엔드에서 섹션별 렌더링 제어가 가능하고, Phase B/C에서 섹션별 갱신 주기를 달리할 수 있다.
- `(symbol, recommendationDate)` UNIQUE: 동일 추천에 대해 리포트가 중복 생성되지 않는다.
  UPSERT로 재실행 시 업데이트된다.
- `recommendationDate`를 FK가 아닌 text로 저장: `recommendations` 테이블과 JOIN은 가능하되
  스키마 의존성을 느슨하게 유지. Phase B/C에서 독립 실행 시나리오를 열어 둔다.

## 에이전트 구현 계획

### 데이터 수집 레이어: `loadAnalysisInputs.ts`

단일 함수 `loadAnalysisInputs(symbol: string, recommendationDate: string)` 가 반환하는 타입:

```typescript
interface AnalysisInputs {
  // 기술적 데이터 (recommendation_factors + stock_phases)
  technical: {
    rsScore: number | null;
    phase: number | null;
    ma150Slope: number | null;
    volRatio: number | null;
    pctFromHigh52w: number | null;
    pctFromLow52w: number | null;
    conditionsMet: string | null; // JSON
    volumeConfirmed: boolean | null;
  };

  // 섹터·업종 RS (sector_rs_daily + industry_rs_daily, 최근 1일)
  sectorContext: {
    sector: string | null;
    industry: string | null;
    sectorRs: number | null;
    sectorGroupPhase: number | null;
    industryRs: number | null;
    industryGroupPhase: number | null;
    sectorChange4w: number | null;  // 4주 RS 변화 → 모멘텀 추정
    sectorChange8w: number | null;
  };

  // 4분기 실적 (quarterly_financials, 최근 4행)
  financials: Array<{
    periodEndDate: string;
    revenue: number | null;
    netIncome: number | null;
    epsDiluted: number | null;
    ebitda: number | null;
    freeCashFlow: number | null;
    grossProfit: number | null;
  }>;

  // 밸류에이션 멀티플 (quarterly_ratios, 최근 1행)
  ratios: {
    peRatio: number | null;
    psRatio: number | null;
    pbRatio: number | null;
    evEbitda: number | null;
    grossMargin: number | null;
    opMargin: number | null;
    netMargin: number | null;
    debtEquity: number | null;
  } | null;

  // 시장 레짐 (market_regimes, 추천일 기준 최신 confirmed)
  marketRegime: {
    regime: string;
    rationale: string;
    confidence: string;
  } | null;

  // 토론 synthesis (debate_sessions, 추천일 기준 최근 1~2개)
  debateSynthesis: string | null; // synthesisReport 텍스트

  // 종목 기본 정보 (symbols 테이블)
  companyName: string | null;
  sector: string | null;
  industry: string | null;
}
```

**구현 원칙:**
- 각 쿼리를 `Promise.all`로 병렬 실행하여 레이턴시 최소화
- 데이터 부재(null) 시 graceful degradation: 가용 데이터만으로 리포트 생성
- `debateSynthesis`는 최근 7일 이내 토론 기준. 오래된 synthesis는 "시장 맥락 미확인" 처리

### 에이전트 코어: `corporateAnalyst.ts`

`reviewAgent.ts`의 단일 LLM 호출 패턴(agentic loop 아님)을 따른다.
툴 없이 순수 LLM 생성으로 구성. 입력 → 프롬프트 조립 → 단일 API 호출 → 구조화 파싱 → 저장.

```typescript
// 모델 선택: claude-sonnet-4-20250514 (run-weekly-agent와 동일)
// max_tokens: 4096 (섹션 7개 × 약 500토큰)
// temperature: 0 (재현성)

interface AnalysisReport {
  investmentSummary: string;
  technicalAnalysis: string;
  fundamentalTrend: string;
  valuationAnalysis: string;
  sectorPositioning: string;
  marketContext: string;
  riskFactors: string;
  tokensInput: number;
  tokensOutput: number;
}

export async function generateAnalysisReport(
  symbol: string,
  inputs: AnalysisInputs,
): Promise<AnalysisReport>
```

**프롬프트 구조:**
- System: "당신은 15년 경력의 미국 주식 전문 기업 애널리스트입니다. 제공된 데이터를 기반으로
  Seeking Alpha 수준의 종목 분석 리포트를 작성합니다. 데이터에 없는 내용은 작성하지 않습니다."
- User: XML 태그로 구조화된 입력 데이터 + 7개 섹션 JSON 출력 지시
- 출력: 순수 JSON (`{"investmentSummary":"...", "technicalAnalysis":"...", ...}`)

**데이터 없는 섹션 처리:** 실적 데이터가 없으면 `fundamentalTrend`에 "실적 데이터 미확인" 명시.
비어있는 척 생성하지 않는다.

### 실행 진입점: `runCorporateAnalyst.ts`

```typescript
export async function runCorporateAnalyst(
  symbol: string,
  recommendationDate: string,
): Promise<{ success: boolean; symbol: string; error?: string }>
```

내부 흐름:
1. 기존 리포트 존재 여부 확인 (UPSERT 전 중복 방지 로그용)
2. `loadAnalysisInputs(symbol, recommendationDate)` 호출
3. `generateAnalysisReport(symbol, inputs)` 호출
4. DB에 UPSERT (`onConflictDoUpdate`)
5. 성공/실패 반환

에러는 throw하지 않고 `{ success: false, error }` 반환.
호출자(saveRecommendations)가 에러를 삼키고 추천 저장은 성공 처리해야 하기 때문.

### 트리거 연결: `saveRecommendations.ts` 수정

추천 DB 저장 직후, 성공한 종목에 대해 비동기로 에이전트 실행:

```typescript
// 기존 saveRecommendations execute 함수 내부, DB 저장 완료 후:
for (const saved of successfullyInserted) {
  // fire-and-forget: 리포트 실패가 추천 저장 성공에 영향 없음
  runCorporateAnalyst(saved.symbol, saved.recommendationDate).catch((err) =>
    logger.warn("CorporateAnalyst", `${saved.symbol} 리포트 생성 실패 (무시): ${err}`)
  );
}
```

**트리거 설계 결정:**
- 동기 await가 아닌 fire-and-forget: 리포트 생성 실패가 추천 저장 실패로 전파되면 안 된다.
  추천은 핵심, 리포트는 부가 기능.
- 직렬 처리 (한 번에 하나씩): 주간 에이전트는 보통 1~5개 종목 추천. rate limit 방지.
- Phase A에서는 ACTIVE 종목 주기 갱신 없음. 신규 추천 시에만 생성.

## 프론트엔드 연결 계획

### Supabase 쿼리 확장

`supabase-queries.ts`에 `fetchAnalysisReport` 함수 추가:

```typescript
export async function fetchAnalysisReport(
  symbol: string,
  recommendationDate: string,
): Promise<AnalysisReport | null>
```

`recommendations/[id]/page.tsx`에서 `fetchRecommendationById`와 병렬로 호출.

### 리포트 컴포넌트: `AnalysisReportCard.tsx`

각 섹션을 아코디언 또는 탭으로 표현. 초기 펼침 상태:
- 투자 포인트 요약: 항상 열림
- 기술적 분석 / 실적 트렌드 / 밸류에이션: 열림
- 섹터 포지셔닝 / 시장 맥락 / 리스크: 열림

리포트 미생성 상태(null)이면 컴포넌트를 렌더링하지 않음. Skeleton 없음 (리포트는 선택적 정보).
생성일(`generatedAt`) 표시하여 데이터 신선도 명시.

### 디테일 페이지 연결

`RecommendationDetail.tsx`에서 `AnalysisReportCard`를 맨 아래 또는 "추천 근거" 바로 아래에 추가.
현재 `reason` 카드는 유지 (기존 데이터 보존).

## 작업 계획

### Step 1: DB 스키마 + 마이그레이션 (백엔드)

**담당**: 구현팀
**완료 기준**:
- `src/db/schema/analyst.ts`에 `stockAnalysisReports` 테이블 정의 추가
- Drizzle migration 파일 생성 (`yarn drizzle-kit generate`)
- Supabase에 마이그레이션 적용

### Step 2: 데이터 로더 구현 (백엔드)

**담당**: 구현팀
**완료 기준**:
- `src/agent/corporateAnalyst/loadAnalysisInputs.ts` 구현
- `loadAnalysisInputs(symbol, date)` 함수 단위 테스트 (Vitest): 각 쿼리가 null 반환 시 graceful degradation 확인
- 테스트 커버리지 80% 이상

**의존성**: Step 1 완료 후

### Step 3: 에이전트 코어 구현 (백엔드)

**담당**: 구현팀
**완료 기준**:
- `src/agent/corporateAnalyst/corporateAnalyst.ts` 구현
- `src/agent/corporateAnalyst/runCorporateAnalyst.ts` 구현
- 단위 테스트: LLM 호출은 모킹, JSON 파싱 실패 시 에러 반환 확인
- 로컬에서 단일 종목 실행 확인 (`tsx src/agent/corporateAnalyst/runCorporateAnalyst.ts NVDA 2026-03-14`)

**의존성**: Step 2 완료 후

### Step 4: 트리거 연결 (백엔드)

**담당**: 구현팀
**완료 기준**:
- `saveRecommendations.ts` 수정: 추천 저장 성공 후 fire-and-forget 트리거
- 기존 `saveRecommendations` 단위 테스트 통과 (리포트 생성 실패가 추천 저장 성공에 영향 없음)
- 통합 테스트: 모킹된 `runCorporateAnalyst`가 추천 저장 후 호출되는지 확인

**의존성**: Step 3 완료 후

### Step 5: 프론트엔드 구현

**담당**: 구현팀
**완료 기준**:
- `fetchAnalysisReport` Supabase 쿼리 함수 추가
- `AnalysisReportCard.tsx` 컴포넌트 구현
- `RecommendationDetail.tsx`에 연결
- 로컬 개발 서버에서 리포트 있는 종목/없는 종목 양쪽 렌더링 확인
- Vitest 컴포넌트 테스트: null 리포트 시 미렌더링 확인

**의존성**: Step 1 완료 후 (Step 2~4와 병렬 가능)

## 테스트 전략

### 단위 테스트

| 테스트 대상 | 검증 포인트 |
|-------------|-------------|
| `loadAnalysisInputs` | 각 쿼리 null 반환 시 graceful degradation |
| `loadAnalysisInputs` | `Promise.all` 병렬 실행 (순서 독립성) |
| `generateAnalysisReport` | LLM 응답 JSON 파싱 성공 경로 |
| `generateAnalysisReport` | LLM 응답이 invalid JSON일 때 에러 반환 |
| `runCorporateAnalyst` | 에러 발생 시 throw 없이 `{ success: false }` 반환 |
| `saveRecommendations` | 리포트 트리거 실패가 추천 저장 성공에 영향 없음 |
| `AnalysisReportCard` | report null 시 null 반환 |
| `AnalysisReportCard` | 모든 섹션이 렌더링되는지 확인 |

### 통합 테스트

- `runCorporateAnalyst` 실제 DB 연결 테스트 (로컬 `.env.test` 필요): 저장 후 조회 일치
- `fetchAnalysisReport`: Supabase에서 저장된 리포트 정확히 조회

### 수동 검증 체크리스트

- [ ] 주간 에이전트 실행 → 신규 추천 발생 → `stock_analysis_reports`에 레코드 생성 확인
- [ ] 디테일 페이지 접속 → 기업 분석 리포트 섹션 표시 확인
- [ ] 리포트 없는 이전 추천 종목 디테일 페이지 → 에러 없이 기존 화면만 표시 확인
- [ ] 동일 종목 재추천 시 UPSERT 동작 (에러 없이 업데이트) 확인

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| 실적 데이터 부재 종목 (IPO 초기 등) | 중 | graceful degradation: "실적 데이터 미확인" 명시 |
| 주간 에이전트 실행 시간 증가 | 낮 | fire-and-forget이므로 주 에이전트 블로킹 없음. 단, 에이전트 종료 후 백그라운드 실행이 pool을 잡을 수 있음 → `pool.end()` 타이밍 주의 |
| LLM 토큰 비용 | 낮 | 종목당 약 1~2K input + 1~2K output tokens. Sonnet 기준 종목당 $0.01 미만 |
| debateSynthesis 크기 | 낮 | synthesis_report가 길 경우 프롬프트 토큰 과다 → 최대 2000자로 트런케이트 |

## 의사결정 필요

없음 — CEO 지시사항(Phase A만 착수, 신규 추천 시 자동 생성, 디테일 페이지 연결)이 이미 명확.
