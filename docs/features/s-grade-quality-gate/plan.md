# S급 심층 분석 데이터 품질 게이트 + 동적 승격

**Issue:** #220
**Branch:** `feature/s-grade-quality-gate`
**트랙:** Lite

---

## 선행 맥락

- PR #218 (`sepa-data-quality-guard`): 비미국 기업 필터 + QoQ 급변 감지를 스코어러에 추가했으나, PR #219에서 anomaly 체크를 제거하고 순수 정량 로직만 남김. `DataQualityFlag` 타입은 plan에만 존재하고 실제 코드에 없는 상태.
- 현재 `FundamentalScore`에 `dataQualityFlags` 필드 없음.
- `promoteTopToS`는 A급 중 rankScore 상위 3개를 기계적으로 S 승격. 데이터 이상 감지 후 제외/보충 로직 전무.
- `analyzeFundamentals` 프롬프트에 데이터 품질 검증 지시 없음.

## 골 정렬

ALIGNED — S급 종목이 리포트로 발행되는데 오염 데이터 기반 가짜 S급이 그대로 노출되면 주도주 포착 정확도가 저하된다. Phase 2 초입 포착이라는 골과 직접 연결.

## 문제

`promoteTopToS`가 A급 상위 3개를 기계적으로 S 승격하므로, 누적 보고/통화 불일치/단위 변경 등으로 실제보다 과장된 성장률을 가진 종목이 S급에 진입할 수 있다. 심층 분석 LLM도 현재는 이 이상을 검증하지 않으므로, 오염 데이터 기반 가짜 S급이 Discord + Gist 리포트로 발행된다.

## Before → After

**Before**
- `promoteTopToS`: A급 rankScore 상위 3개 → 무조건 S
- `analyzeFundamentals`: 내러티브 생성만. 데이터 품질 판단 없음
- S급이 데이터 이상으로 걸러지면 2개 또는 1개로 줄어든 채 리포트 발행

**After**
- `analyzeFundamentals`: S급 대상으로 데이터 품질 검증 관점 추가. LLM이 `dataQualityFlag: "SUSPECT" | "CLEAN"` 반환
- `runFundamentalValidation`: `SUSPECT` 판정 S급을 제외하고 다음 A급 순번으로 보충 → S급 3자리 항상 채움
- 최종 리포트에 `⚠️ 데이터 검토 불통과 — 제외` 로그 포함

## 변경 사항

### 1. `types/fundamental.ts`
- `DataQualityVerdict` union type 추가: `"CLEAN" | "SUSPECT"`
- `FundamentalAnalysis` (현재 `fundamentalAgent.ts` 내부 interface) 확장:
  - `dataQualityVerdict: DataQualityVerdict` 필드 추가
  - `dataQualityReason: string` 필드 추가 (SUSPECT일 때 LLM의 판단 근거)
- `FundamentalScore`에 `dataQualityVerdict?: DataQualityVerdict` 추가 (선택적 — 비S급은 미검증)

### 2. `fundamentalAgent.ts`
- `buildUserMessage`: S급(`isTopGrade === true`) 케이스에 데이터 품질 검증 섹션 추가
  ```
  ## 데이터 품질 검증 (필수)
  아래 관점에서 이 성장률이 실제 영업 성과인지 판단하라:
  1. 누적 보고 의심: 매출/EPS가 특정 분기에 급격히 점프한 후 다음 분기 급락 (재무제표 재작성 패턴)
  2. M&A/사업 매각: 단기 급증 후 기저가 바뀌어 YoY 비교가 무의미한 경우
  3. 통화 불일치: 외화 보고 기업의 환율 효과가 성장률의 대부분을 설명하는 경우
  4. 단위 변경: 특정 분기의 절댓값이 이전/이후 분기와 10배 이상 차이

  판단 결과를 JSON 형식으로 반드시 포함하라:
  {"dataQualityVerdict": "CLEAN" | "SUSPECT", "dataQualityReason": "판단 근거 1-2문장"}
  ```
- `analyzeFundamentals` 반환값: `narrative`에서 JSON 블록을 파싱하여 `dataQualityVerdict`/`dataQualityReason` 추출
  - JSON 파싱 실패 시 기본값 `"CLEAN"` (보수적 — 파싱 오류로 정상 종목을 제외하지 않음)
  - 파싱된 JSON은 narrative에서 제거 (리포트 출력에 raw JSON 노출 방지)

### 3. `runFundamentalValidation.ts`
- S급 LLM 분석 루프 후 동적 승격 로직 삽입:
  ```
  SUSPECT 판정 S급 → sGradeScores에서 제거
  제거된 수만큼 A급 후보(rankScore 내림차순)에서 보충
  보충된 종목 → loadFundamentalData → analyzeFundamentals → sGradeScores에 추가
  ```
- 보충 시 A급 후보 목록: 전체 scores에서 grade === "A"인 종목을 rankScore 내림차순 정렬. 이미 S급인 종목은 제외.
- 보충 종목에 대한 LLM 분석도 동일한 품질 게이트 통과 필요 (재귀 보충은 1회만 — 보충 종목도 SUSPECT면 그냥 제외하고 S급 2개로 종료)
- 로그 추가:
  - `SUSPECT 판정 — ${symbol} S급 제외`
  - `${nextSymbol} A→S 승격 (보충)`
- `ValidationResult`에 `qualityExcluded: string[]` 추가 (모니터링용)

### 4. `stockReport.ts`
- `generateStockReport`: S급 리포트 헤더에 `dataQualityVerdict: "CLEAN"` 표시 추가 (검증 통과 표시)
  - `> 분석일: {date} | 펀더멘탈 등급: **S** | 데이터 품질: ✅ 검증 통과`

## 작업 계획

### Phase 1: 타입 정의
**에이전트:** 구현팀
**파일:** `src/types/fundamental.ts`
**완료 기준:** `tsc --noEmit` 통과

- `DataQualityVerdict` type 추가
- `FundamentalScore`에 `dataQualityVerdict?: DataQualityVerdict` 추가

### Phase 2: LLM 프롬프트 + 파싱 (핵심)
**에이전트:** 구현팀 (TDD)
**파일:** `src/agent/fundamental/fundamentalAgent.ts`
**완료 기준:** 단위 테스트 통과. `buildUserMessage`가 S급 케이스에서 품질 검증 섹션 포함.

- `buildUserMessage` 수정: S급(`isTopGrade === true`)에 데이터 품질 검증 지시 추가
- `analyzeFundamentals` 반환 타입 확장: `dataQualityVerdict`, `dataQualityReason` 포함
- JSON 파싱 헬퍼 `extractDataQualityVerdict(rawNarrative: string)` 추출 (테스트 가능하도록 export)
  - 파싱 성공: `{ verdict: DataQualityVerdict, reason: string, cleanedNarrative: string }`
  - 파싱 실패: `{ verdict: "CLEAN", reason: "", cleanedNarrative: rawNarrative }`

테스트 케이스 (`fundamentalAgent.test.ts` 신규):
- `extractDataQualityVerdict`: JSON 포함 텍스트 → 정상 파싱
- `extractDataQualityVerdict`: JSON 없는 텍스트 → CLEAN 기본값
- `extractDataQualityVerdict`: malformed JSON → CLEAN 기본값
- `buildUserMessage`: `isTopGrade=true` → 데이터 품질 섹션 포함 확인
- `buildUserMessage`: `isTopGrade=false` → 데이터 품질 섹션 미포함 확인

### Phase 3: 동적 승격 로직
**에이전트:** 구현팀 (TDD)
**파일:** `src/agent/fundamental/runFundamentalValidation.ts`
**완료 기준:** 단위 테스트 통과. SUSPECT 종목 제외 + 보충 흐름 정상 동작.

`promoteSuspectFallback` 헬퍼 함수 추출 (테스트 가능하도록):
```typescript
// 순수 함수 — DB/LLM 의존 없음
export function selectFallbackCandidates(
  allScores: FundamentalScore[],
  currentSSymbols: Set<string>,
  neededCount: number,
): FundamentalScore[]  // A급 중 rankScore 내림차순 상위 neededCount개
```

테스트 케이스 (`runFundamentalValidation.test.ts` 신규):
- `selectFallbackCandidates`: S급 3개 모두 CLEAN → 빈 배열 반환
- `selectFallbackCandidates`: S급 1개 SUSPECT → A급 1개 반환
- `selectFallbackCandidates`: A급이 부족하면 있는 만큼만 반환

### Phase 4: 리포트 헤더 업데이트
**에이전트:** 구현팀
**파일:** `src/agent/fundamental/stockReport.ts`
**완료 기준:** `generateStockReport` 출력에 데이터 품질 검증 통과 표시 포함.

- S급 리포트 헤더: `> 분석일: ... | 등급: **S** | 데이터 품질: ✅ 검증 통과`
- A→S 보충 승격 종목 헤더: `> ... | 등급: **S (보충 승격)** | 데이터 품질: ✅ 검증 통과`

### Phase 5: 통합 + 기존 테스트 점검
**에이전트:** 구현팀
**완료 기준:** `yarn test` 전체 통과. 커버리지 80% 이상.

- `ValidationResult` 타입에 `qualityExcluded: string[]` 추가
- 기존 `fundamental-scorer.test.ts` 통과 확인 (타입 변경 영향 최소)
- 전체 `tsc --noEmit` 통과

## 의존성 순서

```
Phase 1 (타입) → Phase 2 (LLM 파싱)
Phase 1 (타입) → Phase 3 (동적 승격)
Phase 2 + Phase 3 → Phase 4 (리포트)
Phase 4 → Phase 5 (통합)
```

Phase 2와 Phase 3은 병렬 진행 가능 (서로 파일이 다름).

## 예상 변경 파일

| 파일 | 변경 성격 |
|------|-----------|
| `src/types/fundamental.ts` | `DataQualityVerdict` 타입 추가, `FundamentalScore` 확장 |
| `src/agent/fundamental/fundamentalAgent.ts` | S급 프롬프트 확장, JSON 파싱 추가 |
| `src/agent/fundamental/runFundamentalValidation.ts` | 동적 승격 로직, `qualityExcluded` 추가 |
| `src/agent/fundamental/stockReport.ts` | 리포트 헤더 품질 검증 표시 |
| `src/agent/fundamental/__tests__/fundamentalAgent.test.ts` | 신규 |
| `src/agent/fundamental/__tests__/runFundamentalValidation.test.ts` | 신규 (selectFallbackCandidates) |

DB 스키마 변경 없음 — `dataQualityVerdict`는 런타임 판단용이며 DB에 저장하지 않는다.
(향후 필요 시 `fundamental_scores.criteria` JSON 컬럼 내에 포함하는 방식으로 확장 가능)

## 리스크

1. **LLM JSON 파싱 신뢰성**: LLM이 지시된 JSON을 항상 반환하지 않을 수 있음. 기본값 `"CLEAN"` 처리로 안전 방향으로 폴백하여 정상 종목 오배제를 방지.
2. **보충 종목의 A→S 승격 과도 사용**: 품질 게이트 기준이 너무 엄격하면 매번 보충이 발생. 초기 운영 후 SUSPECT 판정 빈도를 모니터링하여 기준 조정 필요.
3. **추가 LLM 비용**: 보충 종목에 대해 추가 LLM 호출이 발생. 보충 횟수는 최대 3회 추가이므로 비용 영향 미미.
4. **보충 1회 제한**: 보충 종목도 SUSPECT면 최대 S급 2개로 종료 (무한 루프 방지). 이 경우 로그에 명시.

## 의사결정 필요

없음 — 바로 구현 가능
