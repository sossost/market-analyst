# 재귀 개선 신뢰성 확보

## 선행 맥락

### ROADMAP.md (2026-03-06)
- 학습 루프 현황: `promote-learnings`가 3회+ 적중 시 학습 승격하나, 학습 내용이 thesis 원문 그대로라 추상화/정제 안 됨
- 핵심 리스크로 "LLM 환각 완전 제거 불가" 명시

### chief-of-staff.md
- "같은 LLM이 생성+검증하는 루프" 위험에 대한 무효 판정 체크 규칙 존재 (mission-planner.md)
- CEO 패턴: 비효율 반복에 강하게 반응, 구조적 해결 요구

### 현재 코드 분석 결과
- `thesisVerifier.ts`: **모든** thesis를 LLM이 판정. targetCondition이 "S&P 500 > 5800" 같은 수치 비교여도 LLM에게 맡김
- `promote-learnings.ts`: `MIN_HITS_FOR_PROMOTION = 3`, hitRate 기준 없음 (3회 적중만으로 승격)
- `causalAnalyzer.ts`: `reusablePattern` → `promote-learnings`에서 learning principle로 직접 사용
- `memoryLoader.ts`: confirmed + caution 카테고리 모두 주입, 필터 없음

## 골 정렬

**SUPPORT** — 직접적 주도주 포착이 아니라 학습 루프의 신뢰성 인프라. 하지만 학습 루프가 오염되면 시스템 전체가 잘못된 방향으로 학습하므로, 프로젝트 골 달성의 **필수 전제조건**.

### 무효 판정 체크
- "같은 LLM이 생성+검증하는 루프" → **해당됨**. 현재 Sonnet이 thesis 생성 + thesis 검증 + 인과 분석 + 학습 승격까지 전 과정에 관여. 이번 미션은 이 루프의 취약점을 정량 검증으로 차단하는 것이므로 **유효**.

## 문제

현재 재귀 개선 루프가 **자기 참조적**이다. LLM이 만든 thesis를 LLM이 검증하고, 그 결과로 만든 학습을 다시 LLM에 주입한다. 검증 기준이 느슨하여(3회 적중, hitRate 무관) 노이즈가 학습으로 승격될 수 있다. 이 상태로 시간이 지나면 시스템이 잘못된 패턴을 "검증됨"으로 확신하게 된다.

## Before → After

### Before (현재)

| 영역 | 현재 상태 | 문제 |
|------|----------|------|
| Thesis 검증 | 100% LLM 판정 | "S&P 500 > 5800" 같은 수치 조건도 LLM이 판단 — 환각/오판 가능 |
| 승격 기준 | 3회 적중이면 승격 | hitRate 무관, 관측 수 불충분, 3/10 적중 (30%)도 승격 가능 |
| 메모리 주입 | confirmed + caution 전부 주입 | 검증 안 된 caution 패턴이 분석에 영향 |
| 인과 분석 | reusablePattern → 바로 승격 후보 | LLM이 만든 패턴을 검증 없이 학습으로 승격 |
| 모니터링 | 주간 QA에 thesis 통계 있으나 | LLM 판정 일치율, 정량 vs 정성 비율 추적 없음 |

### After (목표)

| 영역 | 목표 상태 | 효과 |
|------|----------|------|
| Thesis 검증 | 수치 조건 → 정량 자동 판정, 모호한 조건만 LLM | 검증 독립성 확보, LLM 의존도 50%+ 감소 |
| 승격 기준 | 10회+ 적중, 적중률 70%+, 총 관측 10건+ | 통계적으로 유의미한 패턴만 승격 |
| 메모리 주입 | confirmed만 주입, caution 제거 | 오염된 학습의 분석 영향 차단 |
| 인과 분석 | reusablePattern → "참고용" 표시, 승격 기준에서 제외 | LLM 자기참조 루프 차단 |
| 모니터링 | 정량/LLM 판정 비율 + 일치율 추적 | 검증 품질 가시성 확보 |

## 변경 사항

### 1. 정량 규칙 기반 검증 도입 (`thesisVerifier.ts`)

**현재**: `verifyTheses()` → 모든 thesis를 LLM에게 전달
**변경**: targetCondition 파싱 → 수치 비교 가능하면 자동 판정, 나머지만 LLM

구체적으로:
- `parseQuantitativeCondition(targetCondition: string)` 함수 신규
  - 파싱 가능 패턴: `"S&P 500 > 5800"`, `"VIX < 20"`, `"Energy RS > 70"`, `"NVDA > 150"`
  - 반환: `{ metric: string, operator: '>' | '<' | '>=' | '<=', value: number }` 또는 `null`
- `evaluateQuantitativeCondition(condition, marketData)` 함수 신규
  - 시장 데이터에서 해당 지표를 찾아 비교
  - 지표를 찾을 수 없으면 → LLM 폴백 (경고 로그)
- `verifyTheses()` 수정: 정량 판정 가능한 thesis → 자동 처리, 나머지 → 기존 LLM 경로
- invalidationCondition도 동일하게 정량 파싱 적용
- 로그에 `[QUANTITATIVE]` / `[LLM]` 태그로 판정 방식 구분

**지표 매핑 (marketDataContext에서 추출 가능한 것들)**:
- 주요 지수: S&P 500, NASDAQ, Russell 2000, DJI → `marketSnapshot.indices`
- VIX, Fear & Greed → `marketSnapshot` 내 존재
- 섹터 RS → `marketSnapshot.sectors[].avgRs`
- 개별 종목 가격 → ETL DB `stock_phases` 테이블 (필요 시)

### 2. 승격 기준 상향 (`promote-learnings.ts`)

**현재**:
```typescript
const MIN_HITS_FOR_PROMOTION = 3;
// hitRate 기준 없음, 총 관측 수 기준 없음
```

**변경**:
```typescript
const MIN_HITS_FOR_PROMOTION = 10;
const MIN_HIT_RATE = 0.70;
const MIN_TOTAL_OBSERVATIONS = 10;
```

- `buildPromotionCandidates()` 필터에 hitRate + totalObservations 조건 추가
- 기존 활성 learnings 중 새 기준 미달인 것 → 즉시 비활성화하지 않음 (기존 것은 자연 만료에 맡김)
- 신규 승격만 새 기준 적용

### 3. 메모리 주입 필터링 (`memoryLoader.ts`)

**현재**: confirmed + caution 모두 주입
**변경**: confirmed만 주입, caution 섹션 제거

```typescript
// Before
const caution = rows.filter((r) => r.category === "caution");
// "### 경계 패턴 (과거에 틀린 판단)" 섹션 출력

// After
// caution 로딩 및 출력 코드 제거
// confirmed만 남김
```

### 4. 인과 분석 승격 분리 (`promote-learnings.ts`)

**현재**: `reusablePattern` → learning의 `principle`로 직접 사용
**변경**: `reusablePattern`은 `causalAnalysis` JSON 안에만 유지, 승격 시 무시

- `buildPromotionCandidates()`에서 `reusablePatterns` 추출 로직 제거
- learning의 `principle`은 순수 통계 기반 문장으로만 생성:
  ```
  "[persona] verificationMetric 관련 전망이 N회 적중 (적중률 X%, N회 관측)"
  ```
- `causalAnalysis.reusablePattern`은 DB에 그대로 저장 (삭제 안 함) — 향후 수동 참고용

### 5. 모니터링 강화 (`run-weekly-qa.ts`)

주간 QA에 검증 신뢰성 섹션 추가:

- **Thesis 검증 방식 비율**: 정량 자동 판정 vs LLM 판정 건수
- **LLM 판정 일치율**: (선택) 정량 판정 가능했던 thesis를 LLM에도 보내서 일치율 측정 — 비용 이슈로 Phase 2에서는 로그 기반 사후 분석만
- **CONFIRMED/INVALIDATED 비율**: 장관별 + 전체

구현:
- `theses` 테이블에 `verification_method` 컬럼 추가: `'quantitative' | 'llm'`
- 주간 QA 쿼리에 해당 컬럼 기반 통계 추가

## 작업 계획

### Phase 1: 정량 검증 엔진 (핵심)

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 1-1 | `parseQuantitativeCondition()` 함수 TDD | 실행국 (TDD) | 20+ 테스트 케이스 통과 (다양한 조건 포맷 커버) | - |
| 1-2 | `evaluateQuantitativeCondition()` 함수 TDD | 실행국 (TDD) | 지표 매핑 + 비교 로직 테스트 통과 | 1-1 후 |
| 1-3 | `verifyTheses()` 분기 로직 수정 | 실행국 | 정량 가능 → 자동, 불가 → LLM, 로그 태그 구분 | 1-2 후 |
| 1-4 | DB 마이그레이션: `verification_method` 컬럼 | 실행국 | 마이그레이션 실행, 스키마 반영 | 1-1과 병렬 |

**예상 테스트**:
- `parseQuantitativeCondition`: "S&P 500 > 5800" → `{ metric: "S&P 500", operator: ">", value: 5800 }`
- `parseQuantitativeCondition`: "기술주 섹터의 상대적 약세가 지속" → `null` (정량 불가)
- `evaluateQuantitativeCondition`: 지표 있음 → 비교 결과 반환
- `evaluateQuantitativeCondition`: 지표 없음 → `null` (LLM 폴백)
- `verifyTheses` 통합: 5개 thesis 중 3개 정량, 2개 LLM 분기 확인

### Phase 2: 승격 기준 + 메모리 필터 (간단)

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 2-1 | 승격 기준 상향 (`promote-learnings.ts`) | 실행국 | 상수 변경 + 필터 조건 추가 + 기존 테스트 수정 | - |
| 2-2 | reusablePattern 승격 분리 | 실행국 | `buildPromotionCandidates`에서 패턴 추출 제거, 통계 문장만 | 2-1과 병렬 |
| 2-3 | memoryLoader caution 제거 | 실행국 | caution 섹션 출력 코드 제거 + 테스트 수정 | 2-1과 병렬 |

**예상 테스트**:
- `buildPromotionCandidates`: 9회 적중 → 승격 안 됨
- `buildPromotionCandidates`: 10회 적중, 적중률 65% → 승격 안 됨
- `buildPromotionCandidates`: 10회 적중, 적중률 70%, 관측 10건 → 승격
- `buildMemoryContext`: caution 카테고리 rows → 출력에 미포함

### Phase 3: 모니터링 (마무리)

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 3-1 | 주간 QA 쿼리 추가 | 실행국 | verification_method별 통계 쿼리 + 프롬프트 반영 | - |
| 3-2 | 코드 리뷰 + 통합 테스트 | 검증국 | 전체 테스트 통과, 커버리지 80%+ | 3-1 후 |

## 리스크

1. **targetCondition 파싱 범위**: 장관들이 만드는 조건 포맷이 다양함. "S&P 500 > 5800"은 파싱 가능하지만 "에너지 섹터 RS가 상위 3위 유지"는 어려움. 초기에는 단순 비교 (`>`, `<`, `>=`, `<=`)만 지원하고, 파싱 실패 시 LLM 폴백으로 안전하게 처리.

2. **승격 기준 상향의 데이터 부족**: 현재 축적된 thesis가 적으면 10회 적중 기준을 충족하는 패턴이 당분간 없을 수 있음. 이는 의도된 것 — 충분한 관측 없이 승격하지 않는 것이 목적.

3. **기존 learnings 처리**: 새 기준 미달 기존 learnings를 즉시 비활성화하면 메모리가 갑자기 비어짐. 자연 만료(6개월)에 맡기되, 로그로 "기준 미달" 표시.

## 의사결정 필요

1. **정량 판정 시 DB 조회 범위**: 개별 종목 가격 비교가 필요한 경우 (예: "NVDA > 150"), ETL DB의 `stock_phases` 테이블에서 최신 가격을 조회해야 함. 현재 `marketSnapshot`에는 주요 지수/섹터만 포함. 개별 종목까지 지원할지, 지수/섹터 레벨만 지원할지?
   - **내 판단**: 지수 + 섹터 RS + VIX/Fear&Greed만 우선 지원. 개별 종목은 marketSnapshot에 없으므로 LLM 폴백. 향후 필요 시 확장.

2. **기존 활성 learnings 처리 방식**: 새 기준 미달인 기존 learnings를 (a) 자연 만료까지 유지 vs (b) 즉시 `기준미달` 플래그 후 주입 제외?
   - **내 판단**: (a) 자연 만료. 급격한 변경은 시스템 안정성을 해침. caution 제거만으로 충분한 필터링.
