# Plan: SEPA 데이터 품질 방어 로직

**Branch:** `feature/sepa-data-quality-guard`
**Issue:** #217

---

## Phase 1: 타입 확장

**에이전트:** 구현팀
**완료 기준:** 타입 변경 후 `tsc --noEmit` 통과

### Task 1-1: `types/fundamental.ts` 확장

변경 내용:
- `FundamentalGrade`에 `"N/A"` 추가
- `DataQualityFlag` union type 신규 추가
- `FundamentalScore`에 `dataQualityFlags: DataQualityFlag[]` 필드 추가
- `FundamentalInput`에 `sector?: string` 필드 추가

```typescript
export type DataQualityFlag =
  | 'QOQ_SPIKE'
  | 'UNIT_DISCONTINUITY'
  | 'YOY_EXTREME'
  | 'FINANCIAL_SECTOR'

export type FundamentalGrade = "S" | "A" | "B" | "C" | "F" | "N/A"
```

---

## Phase 2: 데이터 로더 섹터 추가

**에이전트:** 구현팀
**완료 기준:** `loadFundamentalData` 반환값에 sector 포함. 기존 테스트 통과.

### Task 2-1: `fundamental-data-loader.ts` 수정

- SQL 쿼리에 `s.sector` JOIN 추가 (`FROM quarterly_financials f JOIN symbols s ON f.symbol = s.symbol`)
- `RawRow`에 `sector: string | null` 추가
- `groupBySymbol`에서 `FundamentalInput.sector` 매핑 추가
- sector는 종목별 첫 번째 행에서 추출 (모든 분기에 동일하므로)

---

## Phase 3: 데이터 품질 감지 로직 구현 (핵심)

**에이전트:** 구현팀 (TDD)
**완료 기준:** 단위 테스트 전부 통과. 커버리지 80% 이상.

### Task 3-1: `fundamental-scorer.ts`에 감지 함수 추가

신규 export 함수:

```typescript
// 금융섹터 여부 판단
export function isFinancialSector(sector: string | undefined): boolean

// QoQ 급변 감지 (5배 이상)
export function detectQoQSpike(quarters: QuarterlyData[]): boolean

// 단위 불연속 감지 (절댓값 10배 이상 점프)
export function detectUnitDiscontinuity(quarters: QuarterlyData[]): boolean

// YoY 이상값 감지 (+1000% 초과)
export function detectYoYExtreme(quarters: QuarterlyData[]): boolean

// 통합 품질 검사 — 위 함수들을 조합
export function assessDataQuality(input: FundamentalInput): DataQualityFlag[]
```

### Task 3-2: `scoreFundamentals` 수정

- `input.sector` 체크 → `FINANCIAL_SECTOR` 플래그
- `assessDataQuality(input)` 호출
- flags가 비어 있지 않으면 `makeNAScore(symbol, flags)` 반환
- 정상이면 기존 스코어링 진행, `dataQualityFlags: []` 포함

### Task 3-3: `promoteTopToS` 수정

- `grade === "A"` 필터 유지 (N/A는 자동 제외)
- 변경 없음 — 타입만 업데이트

### Task 3-4: `makeNAScore` 헬퍼 추가

```typescript
function makeNAScore(symbol: string, flags: DataQualityFlag[]): FundamentalScore {
  // grade: "N/A", 모든 criteria passed: false, dataQualityFlags: flags
}
```

---

## Phase 4: 파이프라인 조정

**에이전트:** 구현팀
**완료 기준:** N/A 종목 LLM 분석 건너뜀. 등급 분포 로그에 N/A 포함.

### Task 4-1: `runFundamentalValidation.ts` 수정

- `gradeCount`에 `"N/A": 0` 추가
- LLM 분석 필터를 `grade === "S"`에서 유지 (N/A는 이미 제외됨)
- `formatFundamentalSupplement`에 N/A 등급 표시 추가:
  - `⚪ N/A {n}개 — 데이터 품질 문제 (상세: dataQualityFlags 참조)`

### Task 4-2: DB 저장 시 N/A 처리

- `saveFundamentalScoresToDB`는 N/A 종목도 그대로 저장
- `criteria` JSON에 `dataQualityFlags` 포함 저장
- 별도 DB 스키마 변경 없음 (grade 컬럼은 text — 'N/A' 저장 가능)

---

## Phase 5: 마이그레이션 스크립트

**에이전트:** 구현팀
**완료 기준:** 스크립트 실행 후 금융섹터 종목 스코어가 N/A로 갱신됨

### Task 5-1: `scripts/migrate-invalidate-contaminated-scores.ts`

```typescript
// 1. symbols 테이블에서 금융섹터 종목 목록 조회
// 2. fundamental_scores에서 해당 종목 grade를 'N/A'로 업데이트
// 3. criteria JSON에 { dataQualityFlags: ['FINANCIAL_SECTOR'] } 추가
// 4. 처리 결과 로그 출력
```

이 스크립트는 배포 직후 1회 수동 실행한다. (`yarn tsx scripts/migrate-invalidate-contaminated-scores.ts`)

---

## Phase 6: 테스트

**에이전트:** 구현팀 (TDD)
**완료 기준:** 모든 테스트 통과. 커버리지 80% 이상.

### Task 6-1: `fundamental-scorer.test.ts` 기존 테스트 유지

기존 모든 테스트 통과 확인 (타입 변경으로 인한 수정 최소화).

### Task 6-2: 신규 테스트 추가

테스트 케이스:
- `isFinancialSector`: Financial Services, Financials, Banks, Insurance → true / Technology → false
- `detectQoQSpike`: 정상 QoQ 변화(2배) → false / 5배 급증 → true / 1/5 급감 → true
- `detectUnitDiscontinuity`: 10배 점프 → true / 정상 → false
- `detectYoYExtreme`: +999% → false / +1001% → true
- `assessDataQuality`: SMFG 실제 데이터 패턴 → FINANCIAL_SECTOR 또는 QOQ_SPIKE 플래그
- `scoreFundamentals` with N/A: N/A 반환, LLM 분석 입력 안 됨
- `promoteTopToS`: N/A 종목이 S 후보에서 제외됨

---

## 의존성 순서

```
Phase 1 (타입) → Phase 2 (로더) → Phase 3 (감지 로직)
Phase 3 → Phase 4 (파이프라인) → Phase 5 (마이그레이션)
Phase 3 → Phase 6 (테스트) ← 병렬로 진행 가능
```

## 예상 변경 파일

| 파일 | 변경 성격 |
|------|-----------|
| `src/types/fundamental.ts` | 타입 확장 |
| `src/lib/fundamental-data-loader.ts` | sector 로드 추가 |
| `src/lib/fundamental-scorer.ts` | 감지 함수 + N/A 처리 |
| `src/agent/fundamental/runFundamentalValidation.ts` | N/A 흐름 조정 |
| `scripts/migrate-invalidate-contaminated-scores.ts` | 신규 마이그레이션 |
| `src/lib/__tests__/fundamental-scorer.test.ts` | 신규 테스트 추가 |

DB 스키마 마이그레이션 없음 (grade 컬럼은 text — 'N/A' 값 그대로 저장 가능).
