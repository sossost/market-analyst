# Corporate Analyst Phase C — 정량 모델 기반 목표주가 산출

## 선행 맥락

- Phase A(#277): `stock_analysis_reports` 테이블 + LLM 7개 섹션 리포트 생성 완료.
- Phase B(#284): FMP API 데이터 13개 병렬 쿼리 확장 완료. `company_profiles`, `annual_financials`,
  `analyst_estimates`, `eps_surprises`, `peer_groups`, `price_target_consensus` 모두 DB에 존재.
- 현재 `valuationAnalysis` 섹션은 LLM이 피어 멀티플을 비교하는 문장을 쓰는 수준.
  "LLM이 숫자를 만들어내는" 구조다.

## 골 정렬

**ALIGNED** — Phase 2 초입 주도주 포착의 판단 속도를 높이는 직접 기여.
목표주가 상승여력(upside)과 월가 컨센서스 대비 위치는 "이 종목을 지금 사야 하는가"에 대한
즉각적인 정량 근거를 제공한다.

## 문제

현재 `valuationAnalysis` 섹션은 LLM이 멀티플 수치를 텍스트로 나열하는 수준이다.
피어 대비 몇 % 할인/프리미엄인지, 월가 컨센서스 대비 현재가는 어디에 있는지,
자체 정량 모델의 적정가는 얼마인지 — 이 세 가지 질문에 답을 주지 못한다.

## Before → After

**Before**: LLM이 "P/E 28.5는 피어 평균 대비 낮은 편입니다"라는 정성 문장을 생성.
목표주가 없음. 상승여력 없음. 월가 컨센서스와의 괴리 정량화 없음.

**After**: 순수 TypeScript 알고리즘이 멀티플 기반 적정가를 산출하고, 월가 컨센서스를 교차 검증한다.
LLM은 이 결과를 받아 "왜 이 숫자가 나왔는가"를 해석하는 역할만 담당한다.
`stock_analysis_reports`에 `price_target` 컬럼이 추가되어 프론트에서 바로 렌더링 가능.

## DCF 간이 모델 포함 여부 판단

**DCF 간이 모델은 이번 Phase C에서 제외한다.**

근거:
1. `analyst_estimates`에는 분기별 추정치만 있다. 3~5년 장기 EPS 추정치가 없다.
   이를 LLM이 보간하면 "LLM이 숫자를 만들어내는" 구조 — Phase C의 핵심 원칙 위반.
2. WACC는 beta, risk-free rate, equity premium을 업종별로 달리 가정해야 하는데,
   이 가정을 하드코딩하면 모델의 신뢰도를 떨어뜨린다.
3. DCF는 입력 가정에 결과가 극도로 민감하다.
   잘못된 WACC/성장률 가정으로 산출한 DCF가 멀티플 기반보다 더 오해를 유발할 수 있다.

따라서 Phase C는 **멀티플 기반 밸류에이션** + **월가 컨센서스 교차 검증** 두 모델로 구성한다.
DCF는 데이터 인프라(장기 EPS 추정치)가 갖춰지면 Phase D에서 검토한다.

## 변경 사항

### 1. 정량 모델 모듈 (신규)

`src/agent/corporateAnalyst/pricingModel.ts`

두 가지 순수 함수 모듈:

**모델 1: 멀티플 기반 밸류에이션**
- 피어 그룹의 유효 멀티플(P/E, EV/EBITDA, P/S)을 수집하여 중앙값 산출
- 자사 최신 분기 EPS / EBITDA / 매출에 피어 중앙값 멀티플 적용
- 복수 멀티플의 가중 평균으로 적정가 산출 (가중치: P/E 50%, EV/EBITDA 30%, P/S 20%)
- 현재가 대비 상승여력(upside %) 계산
- 데이터 부재 시 사용 가능한 멀티플만으로 산출 (graceful degradation)

**모델 2: 월가 컨센서스 교차 검증**
- `price_target_consensus` (targetMedian 기준)와 모델 1 결과를 비교
- 괴리율 산출: `(modelTarget - consensusMedian) / consensusMedian * 100`
- 괴리 방향과 크기에 따라 신뢰도 판정
  - 괴리 ±20% 이내: "컨센서스와 정합" (신뢰도 HIGH)
  - 괴리 ±20~50%: "컨센서스와 괴리" (신뢰도 MEDIUM)
  - 괴리 ±50% 초과: "컨센서스와 큰 괴리 — 데이터 이상 가능성" (신뢰도 LOW)

```typescript
// pricingModel.ts 핵심 타입

export interface PeerMultiples {
  symbol: string;
  peRatio: number | null;
  evEbitda: number | null;
  psRatio: number | null;
}

export interface CompanyMetrics {
  currentPrice: number;
  epsDiluted: number | null;      // 최근 TTM EPS (4분기 합산)
  ebitda: number | null;          // 최근 TTM EBITDA
  revenue: number | null;         // 최근 TTM 매출
  marketCap: number | null;       // 현재 시총 (EV 계산용 근사치)
  sharesOutstanding: number | null; // 발행주식수
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';

export interface MultiplePriceTarget {
  targetPrice: number | null;
  upside: number | null;            // (targetPrice - currentPrice) / currentPrice * 100
  peerMedianPe: number | null;
  peerMedianEvEbitda: number | null;
  peerMedianPs: number | null;
  multiplesUsed: string[];          // 실제 사용된 멀티플 목록 (예: ["P/E", "EV/EBITDA"])
  confidence: ConfidenceLevel;
  note: string | null;              // 데이터 부재/이상 설명
}

export interface ConsensusComparison {
  consensusMedian: number | null;
  consensusHigh: number | null;
  consensusLow: number | null;
  modelTarget: number | null;
  deviationPct: number | null;      // 모델 vs 컨센서스 괴리율
  alignment: 'ALIGNED' | 'DIVERGENT' | 'LARGE_DIVERGENT' | 'NO_DATA';
}

export interface PriceTargetResult {
  multipleModel: MultiplePriceTarget;
  consensus: ConsensusComparison;
  finalTarget: number | null;       // 최종 목표가 (모델 타겟, 컨센서스 신뢰도 HIGH이면 컨센서스 중앙값도 병기)
  finalUpside: number | null;
  generatedAt: string;              // ISO timestamp
}
```

### 2. DB 스키마 확장

`src/db/schema/analyst.ts` — `stockAnalysisReports` 테이블에 컬럼 추가:

```typescript
// 신규 컬럼 (migration으로 추가)
priceTarget: numeric("price_target"),              // 정량 모델 적정가
priceTargetUpside: numeric("price_target_upside"), // 상승여력 (%)
priceTargetData: text("price_target_data"),        // JSON: PriceTargetResult 전체
```

`price_target_data`를 TEXT(JSON)로 저장하는 이유: 멀티플 분해, 컨센서스 비교 등 디테일 정보를
프론트가 파싱하여 활용할 수 있도록 보존. `price_target`, `price_target_upside`는 빠른 렌더링을 위한
요약 컬럼.

### 3. `loadAnalysisInputs.ts` 확장

`CompanyMetrics` 계산을 위한 추가 데이터 수집:
- TTM EPS: `quarterly_financials` 최근 4분기 `eps_diluted` 합산
- TTM EBITDA: `quarterly_financials` 최근 4분기 `ebitda` 합산
- TTM 매출: `quarterly_financials` 최근 4분기 `revenue` 합산
- 발행주식수: `company_profiles.shares_outstanding` (없으면 `market_cap / current_price`로 근사)

기존 쿼리 범위 확장 — 신규 DB 쿼리 없이 이미 조회한 데이터를 집계하는 방식으로 처리.
`shares_outstanding` 필드가 `company_profiles` 스키마에 없으면 `market_cap / current_price`
근사치를 사용하고 `note`에 명시.

`AnalysisInputs`에 신규 필드 추가:
```typescript
companyMetrics: CompanyMetrics | null;  // 정량 모델용 TTM 집계값
currentPrice: number | null;            // daily_prices 또는 stock_phases.close
```

현재가 조회 방법: `stock_phases` 테이블의 `close` 필드가 없으면
`daily_prices` 테이블에서 `recommendationDate` 이하 최신 종가 조회.

### 4. `corporateAnalyst.ts` 확장

`generateAnalysisReport` 함수 수정:
- `pricingModel.ts`의 `computePriceTarget(inputs)` 호출 (LLM 호출 전)
- `PriceTargetResult`를 `<price_target_model>` XML 태그로 프롬프트에 주입
- LLM 역할: 수치가 왜 나왔는지, 어떤 가정이 들어있는지, 한계는 무엇인지 해석
- `AnalysisReport` 인터페이스에 `priceTargetAnalysis: string` 필드 추가 (8번째 섹션)
- SYSTEM_PROMPT 업데이트: `priceTargetAnalysis` 섹션 지침 추가

SYSTEM_PROMPT 추가 지침:
```
- priceTargetAnalysis: price_target_model 데이터를 기반으로 작성.
  적정가 산출 근거(어떤 멀티플을 사용했는가), 상승여력 해석,
  월가 컨센서스와의 비교, 모델의 한계(데이터 부재, 가정 등)를 명시.
  데이터가 불충분하면 "정량 모델 산출 불가 — 이유 명시" 형식으로 작성.
```

### 5. `runCorporateAnalyst.ts` 확장

DB UPSERT에 신규 컬럼 추가:
- `price_target`, `price_target_upside`: `PriceTargetResult`에서 추출
- `price_target_data`: `JSON.stringify(priceTargetResult)`

## 작업 계획

### Step 1: 정량 모델 모듈 구현

**파일**: `src/agent/corporateAnalyst/pricingModel.ts`
**담당**: 구현팀
**완료 기준**:
- `computeMedianPeerMultiples(peers: PeerMultiples[]): MedianMultiples` 구현
- `computeMultiplePriceTarget(company: CompanyMetrics, peerMedians: MedianMultiples): MultiplePriceTarget` 구현
- `computeConsensusComparison(modelTarget: number | null, consensus: PriceTargetConsensusInput): ConsensusComparison` 구현
- `computePriceTarget(inputs: AnalysisInputs): PriceTargetResult` — 위 세 함수를 조합하는 진입점
- 단위 테스트 `__tests__/pricingModel.test.ts`: LLM 호출 없음, 순수 계산 로직만

**테스트 케이스 (필수)**:
- 피어 3개 중 P/E null 1개인 경우 나머지 2개 중앙값으로 계산
- 피어 전부 null인 경우 `INSUFFICIENT_DATA` 반환
- 단일 멀티플만 사용 가능한 경우 `multiplesUsed: ["P/E"]`로 명시
- 월가 컨센서스 없는 경우 `alignment: 'NO_DATA'`
- 현재가 0 또는 null인 경우 upside 계산 스킵
- TTM EPS 음수(적자)인 경우 P/E 멀티플 제외 처리

**의존성**: 없음 — 이 Step은 독립적으로 시작 가능

### Step 2: DB 스키마 + 마이그레이션

**파일**: `src/db/schema/analyst.ts`, 새 migration 파일
**담당**: 구현팀
**완료 기준**:
- `stockAnalysisReports`에 `price_target`, `price_target_upside`, `price_target_data` 컬럼 추가
- `yarn drizzle-kit generate`로 migration 파일 생성
- Supabase에 migration 적용 확인

**의존성**: 없음 — Step 1과 병렬 가능

### Step 3: `loadAnalysisInputs.ts` 확장

**파일**: `src/agent/corporateAnalyst/loadAnalysisInputs.ts`
**담당**: 구현팀
**완료 기준**:
- `AnalysisInputs`에 `currentPrice: number | null` 필드 추가
- `AnalysisInputs`에 `companyMetrics: CompanyMetrics | null` 필드 추가
- `currentPrice` 조회: `stock_phases` WHERE symbol + date (없으면 `daily_prices` fallback)
- `companyMetrics.ttmEps`: `financials` 배열에서 `epsDiluted` 4분기 합산 (null 제외)
- `companyMetrics.ttmEbitda`: `ebitda` 4분기 합산
- `companyMetrics.ttmRevenue`: `revenue` 4분기 합산
- `companyMetrics.sharesOutstanding`: `company_profiles.market_cap / currentPrice`로 근사
- 기존 단위 테스트 통과 유지
- 신규 테스트: TTM 집계 null 처리 검증

**의존성**: Step 1 완료 후 (CompanyMetrics 타입 참조)

### Step 4: `corporateAnalyst.ts` + `runCorporateAnalyst.ts` 확장

**파일**: `src/agent/corporateAnalyst/corporateAnalyst.ts`, `runCorporateAnalyst.ts`
**담당**: 구현팀
**완료 기준**:
- `computePriceTarget(inputs)` 호출 + `<price_target_model>` 태그 프롬프트 주입
- `AnalysisReport`에 `priceTargetAnalysis: string` 추가
- SYSTEM_PROMPT에 `priceTargetAnalysis` 지침 추가
- `isValidReport` 검증 로직에 `priceTargetAnalysis` 필드 추가
- `runCorporateAnalyst.ts` UPSERT 쿼리에 3개 신규 컬럼 추가
- 기존 테스트 전부 통과
- 신규 테스트: `priceTargetAnalysis` 필드 검증, price_target_data 직렬화

**의존성**: Step 1, Step 2, Step 3 완료 후

### Step 5: 로컬 통합 검증

**담당**: 구현팀
**완료 기준**:
- `tsx src/agent/run-corporate-analyst.ts NVDA 2026-03-14` 실행
- DB에 `price_target`, `price_target_upside` 저장 확인
- `price_target_data` JSON 파싱 가능 확인
- 피어 데이터 없는 종목(예: 소형주)도 에러 없이 `INSUFFICIENT_DATA`로 처리 확인

**의존성**: Step 4 완료 후

## 테스트 전략

| 테스트 대상 | 검증 포인트 | 종류 |
|-------------|-------------|------|
| `computeMedianPeerMultiples` | null 제외 중앙값, 전체 null 처리 | 단위 |
| `computeMultiplePriceTarget` | 가중 평균 산출, 적자(EPS<0) P/E 제외 | 단위 |
| `computeConsensusComparison` | 괴리율 계산, alignment 판정 | 단위 |
| `computePriceTarget` | inputs null 필드 있을 때 graceful degradation | 단위 |
| `loadAnalysisInputs` | TTM 집계 정확성, currentPrice fallback | 단위 |
| `generateAnalysisReport` | `priceTargetAnalysis` 필드 포함 여부 | 단위 (LLM mock) |
| `runCorporateAnalyst` | 신규 컬럼 UPSERT, price_target_data 직렬화 | 단위 (DB mock) |

**커버리지 목표**: pricingModel.ts 95% 이상 (순수 계산 로직이므로 달성 가능)

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| `company_profiles`에 `shares_outstanding` 없음 | 중 | `market_cap / currentPrice`로 근사. EV/EBITDA 계산 시 시총을 EV로 사용(부채 무시). `note`에 "EV ≈ 시총 (부채 미반영)" 명시 |
| TTM EPS 음수(적자 기업) | 중 | P/E 멀티플 자동 제외. EV/EBITDA 또는 P/S만으로 산출. 모두 음수면 INSUFFICIENT_DATA |
| 피어 그룹이 없거나 멀티플이 전부 null | 중 | `multipleModel.confidence = 'INSUFFICIENT_DATA'`. LLM에 데이터 부재 사실 그대로 전달 |
| 월가 컨센서스와 자체 모델 괴리 큰 경우 | 낮 | 괴리율 그대로 표시. LLM이 해석. 사용자에게 판단 위임 |
| 기존 `valuationAnalysis` 섹션과 내용 중복 | 낮 | `valuationAnalysis`는 멀티플 비교 문장 유지, `priceTargetAnalysis`는 적정가 수치와 해석에 집중. 중복 최소화 지침을 SYSTEM_PROMPT에 추가 |

## 의사결정 필요

없음 — DCF 제외 결정, 멀티플 가중치(P/E 50% / EV/EBITDA 30% / P/S 20%), 컨센서스 괴리 임계값(±20%/±50%)은 매니저 판단으로 확정.
프론트엔드 연동은 이번 PR 범위 밖 — 별도 이슈로 분리.
