# Corporate Analyst — Phase B 구현 플랜
# FMP API 데이터 확장

## 선행 맥락

Phase A (`docs/features/corporate-analyst/plan.md`, PR #278)에서 다음이 구현되었다:
- `stock_analysis_reports` 테이블 (symbol + recommendation_date UNIQUE)
- `src/agent/corporateAnalyst/` — loadAnalysisInputs, corporateAnalyst, runCorporateAnalyst
- 7개 섹션 리포트: investmentSummary, technicalAnalysis, fundamentalTrend, valuationAnalysis, sectorPositioning, marketContext, riskFactors
- 추천 저장 시 fire-and-forget 트리거, 프론트엔드 디테일 페이지 연결

Phase A의 데이터 소스는 전부 기존 DB (quarterly_financials, quarterly_ratios, sector_rs_daily 등)이다.
Phase B는 FMP API에서 직접 데이터를 가져와 분석 품질을 상향하는 단계다.

기존 ETL 패턴 (`src/etl/jobs/load-quarterly-financials.ts`):
- `process.env.DATA_API + "/stable"` 베이스 URL
- `fetchJson<T[]>(url)` 헬퍼 사용
- `pLimit(CONCURRENCY)` + `sleep(PAUSE_MS)` rate-limit 준수
- `db.insert(...).onConflictDoUpdate(...)` UPSERT 패턴

## 골 정렬

**ALIGNED** — Phase 2 초입 주도주를 남들보다 먼저 포착하는 핵심 우위는 정보의 질과 속도다.
기업 프로필(사업 구조), 어닝콜 트랜스크립트(경영진 가이던스), 포워드 EPS 추정치(성장 모멘텀 방향),
동종업계 피어 대비 밸류에이션 포지션은 Phase 2 초입 판단에 직접 기여한다.
"컨센서스 대비 서프라이즈 트랙 레코드"는 구조적 모멘텀과 일시적 이벤트를 구분하는 필터다.

## 문제

Phase A 리포트의 `valuationAnalysis` 섹션은 종목 자체 멀티플(P/E, EV/EBITDA)만 제공한다.
피어 대비 포지션이 없어 "이 밸류에이션이 싼지 비싼지" 판단 근거가 약하다.

`fundamentalTrend` 섹션은 과거 4분기 실적만 포함한다.
포워드 EPS 컨센서스와 서프라이즈 히스토리가 없으면 성장 가속 판단에 맹점이 생긴다.

어닝콜 트랜스크립트는 Phase 2 초입의 가장 강력한 신호(경영진이 가이던스를 올리는 시점)인데
현재 리포트에 전혀 포함되지 않는다.

## Before → After

**Before**: 추천 리포트가 내부 DB 데이터(과거 실적, 기술적 팩터)만으로 생성된다.
밸류에이션 비교 기준 없음, 포워드 성장 모멘텀 없음, 경영진 시그널 없음.

**After**: FMP API 5개 데이터 소스가 추가되어 리포트에 다음이 포함된다:
- 기업 프로필 (사업 설명, 시가총액, CEO, 직원수 → investmentSummary 강화)
- 연간 재무제표 3년치 (장기 성장 트렌드 → fundamentalTrend 강화)
- 어닝콜 핵심 발언 + 톤 분석 (경영진 가이던스 → 별도 earningsCallHighlights 섹션 추가)
- EPS/매출 컨센서스 + 서프라이즈 히스토리 (포워드 모멘텀 + 신뢰성 → fundamentalTrend 강화)
- 동종업계 피어 멀티플 비교 (할인/프리미엄 포지션 → valuationAnalysis 강화)
- 가격 목표 컨센서스 (월가 뷰 → valuationAnalysis 강화)

## 변경 사항

### 1. FMP API ETL 잡 신규 추가 (`src/etl/jobs/`)

#### 1-a. `load-company-profiles.ts`
- 엔드포인트: `/stable/profile?symbol={symbol}&apikey={key}`
- 저장 테이블: `company_profiles` (신규)
- 수집 주기: 주 1회 (분기 업데이트 빈도에 맞게)
- 핵심 필드: symbol, companyName, description, ceo, employees, marketCap, sector, industry, website

#### 1-b. `load-annual-financials.ts`
- 엔드포인트: `/stable/income-statement?symbol={symbol}&period=annual&limit=3&apikey={key}`
- 저장 테이블: `annual_financials` (신규)
- 기존 `quarterly_financials`와 동일한 스키마 구조, period 컬럼 추가
- 핵심 필드: symbol, fiscalYear, revenue, netIncome, epsDiluted, grossProfit, operatingIncome

#### 1-c. `load-earnings-transcripts.ts`
- 엔드포인트: `/stable/earning-call-transcript?symbol={symbol}&apikey={key}`
- 저장 테이블: `earning_call_transcripts` (신규)
- 최근 2분기 트랜스크립트 저장 (토큰 비용 통제)
- 핵심 필드: symbol, quarter, year, date, transcript (TEXT — 원문 전체)
- 주의: 트랜스크립트 원문은 최대 수만 자 → DB에는 전체 저장, 에이전트 주입 시 최대 3,000자로 트런케이트

#### 1-d. `load-analyst-estimates.ts`
- 엔드포인트: `/stable/analyst-estimates?symbol={symbol}&period=quarterly&limit=4&apikey={key}`
- 저장 테이블: `analyst_estimates` (신규)
- 핵심 필드: symbol, period, estimatedEpsAvg, estimatedEpsHigh, estimatedEpsLow, estimatedRevenueAvg, numberAnalystEstimatedEps
- EPS 서프라이즈: `/stable/earnings-surprises?symbol={symbol}&limit=4&apikey={key}` → 동일 테이블 또는 별도 `eps_surprises` 테이블에 저장

#### 1-e. `load-peer-groups.ts`
- 엔드포인트: `/api/v4/stock_peers?symbol={symbol}&apikey={key}`로 피어 목록 조회 후
  각 피어의 밸류에이션 멀티플을 `quarterly_ratios`에서 조회 (추가 API 호출 없음)
- 저장 방식: `peer_groups` 테이블에 (symbol, peers: string[]) 저장
- 피어 멀티플은 기존 DB 데이터 활용 — 새 테이블 불필요

#### 1-f. `load-price-targets.ts`
- 엔드포인트: `/stable/price-target-consensus?symbol={symbol}&apikey={key}`
- 저장 테이블: `price_target_consensus` (신규)
- 핵심 필드: symbol, targetHigh, targetLow, targetMean, targetMedian, lastUpdated

### 2. DB 마이그레이션

새 테이블 7개 추가 (Drizzle schema → migrate):

| 테이블 | 인덱스 | UNIQUE |
|--------|--------|--------|
| `company_profiles` | symbol | symbol |
| `annual_financials` | symbol, fiscal_year | (symbol, fiscal_year) |
| `earning_call_transcripts` | symbol | (symbol, quarter, year) |
| `analyst_estimates` | symbol, period | (symbol, period) |
| `eps_surprises` | symbol | (symbol, actual_date) |
| `peer_groups` | symbol | symbol |
| `price_target_consensus` | symbol | symbol |

### 3. `loadAnalysisInputs.ts` 확장

기존 6개 병렬 쿼리에 7개 추가 (총 13개 병렬):
- `companyProfile` — company_profiles 조회
- `annualFinancials` — annual_financials 최근 3년
- `earningsCallHighlights` — earning_call_transcripts 최근 1개, 3,000자 트런케이트
- `analystEstimates` — analyst_estimates 최근 4분기 포워드 추정치
- `epsSurprises` — eps_surprises 최근 4분기
- `peerComparison` — peer_groups + 피어별 quarterly_ratios 조회 (DB JOIN)
- `priceTargetConsensus` — price_target_consensus

### 4. `corporateAnalyst.ts` 프롬프트 확장

`buildUserPrompt` 함수에 새 XML 태그 섹션 추가:

```
<company_profile>
사업 설명, CEO, 직원수, 시가총액 등
</company_profile>

<annual_trend>
3개년 연간 매출/순이익/EPS 성장률 (장기 트렌드)
</annual_trend>

<earnings_call>
최근 어닝콜 핵심 발언 (트런케이트된 하이라이트)
</earnings_call>

<forward_estimates>
컨센서스 EPS/매출 추정치 + 서프라이즈 히스토리 4분기
</forward_estimates>

<peer_valuation>
피어 그룹 P/E, EV/EBITDA 중간값 vs 대상 종목
</peer_valuation>

<price_targets>
월가 목표가 High/Low/Median + 현재가 대비 괴리율
</price_targets>
```

리포트 필드 변경:
- 기존 7개 섹션 유지
- `earningsCallHighlights` 섹션 신규 추가 (총 8개)
- `valuationAnalysis` 프롬프트 지시: 피어 대비 할인/프리미엄 포지션 명시 요청
- `fundamentalTrend` 프롬프트 지시: 포워드 EPS 방향성 + 서프라이즈 트랙 레코드 포함 요청

### 5. DB 스키마 (`analyst.ts`) 확장

`stock_analysis_reports` 테이블에 `earningsCallHighlights` 컬럼 추가.
Drizzle onConflictDoUpdate에 신규 컬럼 포함.

### 6. 프론트엔드 리포트 렌더링 확장

`AnalysisReportCard.tsx`에 `earningsCallHighlights` 섹션 추가.
Supabase 쿼리에서 신규 컬럼 포함.

## SEC 파일링 제외 판단

**Phase B에서 SEC 파일링(10-K/10-Q) 제외 — 권고.**

이유 3가지:
1. **토큰 비용**: 10-K 원문은 수백 페이지. 의미 있는 분석을 위해서는 최소 50,000~200,000 토큰이 필요하다. 종목당 $1~5 이상 — 현재 아키텍처(단일 LLM 호출)로는 불가.
2. **중복**: 어닝콜 트랜스크립트 + 분기 실적 데이터가 SEC 파일링의 핵심 수치를 이미 커버한다. SEC 파일링의 차별적 가치는 "위험 요소" 섹션 등 질적 분석인데, 이는 Phase C에서 전용 파서로 다루는 것이 적절하다.
3. **우선순위**: Phase 2 초입 포착에 SEC 파일링보다 어닝콜 + 포워드 추정치가 더 즉각적인 시그널이다.

**Phase C 후보로 이관**: SEC 10-K "Risk Factors" + "Business Overview" 섹션만 추출하는 전용 파서 구현.

## ETL 실행 전략

### 수집 대상 종목

전체 symbols 테이블 대상 실행은 비용/시간 초과 위험이 있다.
**Phase B는 추천이력이 있는 종목만 수집한다** — 우선순위가 명확하고 비용 통제가 가능하다.

```sql
-- 수집 대상 쿼리 (ETL 잡 내부에서 사용)
SELECT DISTINCT symbol FROM recommendations
WHERE status IN ('ACTIVE', 'CLOSED')
ORDER BY symbol
```

전체 symbols(~5,000개) 대신 추천 종목(~100~500개)으로 한정하면 API 비용 90% 절감.

### 실행 주기

| ETL 잡 | 주기 | 비고 |
|--------|------|------|
| load-company-profiles | 주 1회 (일요일) | 분기에 한 번 바뀌는 정보 |
| load-annual-financials | 분기 1회 | 어닝 시즌 직후 |
| load-earnings-calendar (transcript) | 분기 1회 | 어닝콜 직후 |
| load-analyst-estimates | 주 1회 | 컨센서스 업데이트 빈도 |
| load-peer-comparisons | 월 1회 | 피어 그룹 변경 드물음 |
| load-price-targets | 주 1회 | 목표가 업데이트 빈도 |

### Rate Limit 준수

기존 ETL 패턴 동일: `CONCURRENCY = 4`, `PAUSE_MS = 150ms`.
트랜스크립트 엔드포인트는 응답 크기가 크므로 `CONCURRENCY = 2`로 제한.

## 작업 계획

### Step 1: DB 스키마 + 마이그레이션

**담당**: 구현팀
**완료 기준**:
- `src/db/schema/` 에 7개 신규 테이블 정의 (analyst.ts 또는 market.ts에 추가)
- Drizzle migration 파일 생성 (`yarn drizzle-kit generate`)
- Supabase에 마이그레이션 적용 확인
- TypeScript 타입 에러 없음 (`yarn tsc --noEmit`)

### Step 2: FMP ETL 잡 구현 (5개)

**담당**: 구현팀
**병렬 가능**: Step 2-a~f는 스키마 완료 후 병렬 개발 가능

#### Step 2-a: load-company-profiles.ts
**완료 기준**:
- FMP `/stable/profile` 호출 + `company_profiles` 테이블 UPSERT
- 단위 테스트: fetchJson 모킹, UPSERT 로직 확인
- 추천 종목 5개에 대해 로컬 실행 성공

#### Step 2-b: load-annual-financials.ts
**완료 기준**:
- FMP `/stable/income-statement?period=annual&limit=3` 호출 + `annual_financials` UPSERT
- 단위 테스트 + 로컬 실행 성공

#### Step 2-c: load-earnings-transcripts.ts
**완료 기준**:
- FMP `/stable/earning-call-transcript` 호출 + `earning_call_transcripts` UPSERT
- 최근 2분기 트랜스크립트 저장 (limit=2)
- 단위 테스트: 트런케이트 로직 (3,000자 초과 시) 확인
- 로컬 실행 성공 + DB에 트랜스크립트 저장 확인

#### Step 2-d: load-analyst-estimates.ts
**완료 기준**:
- FMP `/stable/analyst-estimates` + `/stable/earnings-surprises` 호출
- `analyst_estimates` + `eps_surprises` UPSERT
- 단위 테스트 + 로컬 실행 성공

#### Step 2-e: load-peer-groups.ts
**완료 기준**:
- FMP `/api/v4/stock_peers` 호출 + `peer_groups` UPSERT (peers 배열을 JSONB로 저장)
- 단위 테스트 + 로컬 실행 성공

#### Step 2-f: load-price-targets.ts
**완료 기준**:
- FMP `/stable/price-target-consensus` 호출 + `price_target_consensus` UPSERT
- 단위 테스트 + 로컬 실행 성공

**의존성**: Step 1 완료 후

### Step 3: loadAnalysisInputs.ts 확장

**담당**: 구현팀
**완료 기준**:
- 기존 6개 쿼리에 5개 추가 (모두 Promise.all 병렬)
- `AnalysisInputs` 인터페이스 확장 (신규 필드 추가)
- 기존 단위 테스트 통과 유지
- 신규 쿼리에 대한 단위 테스트 추가: 데이터 부재 시 null 반환 확인
- 테스트 커버리지 80% 이상 유지

**의존성**: Step 1 완료 후 (Step 2와 병렬 가능 — DB 스키마만 있으면 쿼리 작성 가능)

### Step 4: corporateAnalyst.ts 프롬프트 확장

**담당**: 구현팀
**완료 기준**:
- `buildUserPrompt` 함수에 새 XML 섹션 6개 추가
- `AnalysisReport` 인터페이스에 `earningsCallHighlights` 필드 추가
- `REQUIRED_REPORT_FIELDS` 배열 업데이트 (8개)
- 단위 테스트: 신규 필드 파싱 실패 시 에러 반환 확인
- 로컬에서 단일 종목 실행 + 리포트 품질 육안 확인 (NVDA 또는 AAPL)

**의존성**: Step 3 완료 후

### Step 5: DB 스키마 + 프론트엔드 컬럼 추가

**담당**: 구현팀
**완료 기준**:
- `stock_analysis_reports` 테이블에 `earnings_call_highlights` 컬럼 추가 마이그레이션
- `runCorporateAnalyst.ts` INSERT/UPDATE 쿼리에 신규 컬럼 포함
- Supabase 쿼리 (`supabase-queries.ts`) 신규 컬럼 포함
- `AnalysisReportCard.tsx`에 어닝콜 섹션 렌더링 추가
- 로컬 개발 서버에서 리포트 전체 섹션 렌더링 확인

**의존성**: Step 4 완료 후

## 테스트 전략

### 단위 테스트 (신규)

| 테스트 대상 | 검증 포인트 |
|-------------|-------------|
| 각 ETL 잡 | fetchJson 모킹, UPSERT 로직, rate-limit 준수 |
| `loadAnalysisInputs` (확장) | 신규 쿼리 null 반환 시 graceful degradation |
| `buildUserPrompt` (확장) | 신규 섹션이 올바르게 XML 태그로 포함되는지 |
| `generateAnalysisReport` (확장) | 8개 필드 JSON 파싱 성공/실패 경로 |
| 트랜스크립트 트런케이트 | 3,000자 초과 입력 시 정확히 잘림 |

### 수동 검증 체크리스트

- [ ] 추천 종목 5개에 대해 각 ETL 잡 실행 → DB에 데이터 적재 확인
- [ ] Phase B 리포트 생성 (`runCorporateAnalyst NVDA 2026-03-14`) → 어닝콜/피어/포워드 섹션 포함 확인
- [ ] 프론트엔드 디테일 페이지: 어닝콜 섹션 렌더링 확인
- [ ] ETL 데이터 없는 종목: 기존 7섹션만 표시, 에러 없음 확인

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| 어닝콜 트랜스크립트 FMP 커버리지 부족 | 중 | 소형주/신규 상장 종목은 트랜스크립트 없을 수 있음. null 처리로 graceful degradation |
| 프롬프트 토큰 증가 (섹터당 500~1,000자 추가) | 중 | 트랜스크립트 3,000자 + 기타 섹션 합산 약 8,000~10,000 input tokens. Sonnet 기준 종목당 $0.02~0.03. 허용 범위 |
| 피어 멀티플 데이터 신선도 | 낮 | quarterly_ratios는 분기 1회 업데이트 → 피어 비교도 분기 기준으로 명시 |
| ETL 실행 시간 (추천 종목 100개 기준) | 낮 | CONCURRENCY=4, PAUSE=150ms 기준 약 40분. 주간 실행으로 충분 |
| FMP API rate limit (Professional 플랜) | 낮 | 기존 ETL 패턴 동일. 추천 종목 한정으로 요청 수 제한됨 |

## 의사결정 필요

없음. 아래 판단은 이 기획서에서 자율 결정:
- SEC 파일링 제외: 토큰 비용 + 우선순위 근거로 Phase C 이관 결정
- ETL 대상 종목 한정: 전체 symbols 대신 추천이력 종목만 — 비용/시간 통제
- 트랜스크립트 3,000자 트런케이트: 어닝콜 핵심 발언은 도입부 + 경영진 코멘트 앞쪽에 집중됨
