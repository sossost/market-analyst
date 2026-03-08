# 서사 레이어 Wave 1 완결 — N+1 병목 예측 + 합의도 추적 (N-1c, N-1d)

이슈: #78
RFC 참조: `docs/RFC-narrative-layer.md` 제안 1-F, 제안 9
선행 기획서: `docs/features/narrative-layer/01-spec.md` (N-1a, N-1b)

---

## 선행 맥락

**PR #82에서 완료된 사항:**
- N-1a: 4개 애널리스트 systemPrompt에 수요-공급-병목 4가지 질문 프레임 추가
- N-1b: `theses` 테이블에 `category` 컬럼 추가 (structural_narrative / sector_rotation / short_term_outlook)
- 라운드3 synthesis 프롬프트에 카테고리 분류 기준 + JSON 스키마 업데이트
- `getThesisStatsByCategory` 집계 함수 추가

**현재 코드베이스 상태:**

`src/types/debate.ts`:
- `ConsensusLevel = "4/4" | "3/4" | "2/4" | "1/4"` 타입 존재
- `Thesis` 인터페이스에 `consensusLevel` 필드 있음
- `next_bottleneck` 필드 없음

`src/db/schema/analyst.ts` — `theses` 테이블:
- `consensusLevel: text("consensus_level")` — 이미 존재 (N-1b PR에서 추가된 것으로 확인)
- `consensus_score`, `dissent_reason` 컬럼 없음
- `next_bottleneck` 관련 컬럼 없음

`src/agent/debate/round3-synthesis.ts`:
- 모더레이터가 thesis JSON에 `consensusLevel` 필드를 생성함 (`"4/4"`, `"3/4"`, `"2/4"`, `"1/4"`)
- 라운드3 프롬프트에 N+1 병목 관련 질문 없음
- `buildSynthesisPrompt`에 `next_bottleneck` 추출 로직 없음

`src/agent/debate/thesisStore.ts`:
- `formatThesesForPrompt`가 `[STRUCTURAL][HIGH/3/4]` 형식으로 카테고리+합의도를 이미 출력함
- `consensus_score`별 적중률 분리 쿼리 없음

**메모리 검색 결과:** `memory/` 디렉토리에 병목 예측 또는 합의도 추적 관련 기존 결정 없음.

---

## 골 정렬

**ALIGNED** — 직접 기여.

N+1 병목 예측은 "다음 알파를 미리 포착"하는 핵심 기능이다. 현재 병목이 해소될 때 공급 체인의 다음 노드가 병목이 되는 패턴(GPU → 메모리 → 광통신 → 전력 → 냉각)은 Phase 2 초입 종목을 남들보다 먼저 포착하는 직접적인 수단이다.

합의도 추적은 "만장일치 컨센서스는 이미 시장에 반영되었을 가능성이 있다"는 가설을 검증한다. 4/4보다 3/4가 더 높은 알파를 낸다면, 시스템은 비컨센서스 thesis를 우선시해야 한다. 이는 Phase 2 초입 포착의 알파 형성 메커니즘을 직접 개선한다.

---

## 문제

**N-1c**: 현재 토론에서 "지금 병목이 해소되면 다음 제약은 어디인가?"라는 질문이 없다. `next_bottleneck` 정보가 thesis에 포함되지 않아 다음 사이클의 수혜 섹터를 미리 주시할 수 없다.

**N-1d**: `consensusLevel` 필드는 이미 thesis에 저장되지만, 합의도별 적중률을 분리 추적하는 쿼리가 없다. "3/4 thesis가 4/4 thesis보다 알파가 높은가?"라는 핵심 가설을 검증할 수단이 없다.

---

## Before → After

**Before**

- 라운드3 프롬프트: N+1 병목 예측 질문 없음. 모더레이터가 현재 병목만 분석.
- theses 테이블: `consensus_score`, `dissent_reason`, `next_bottleneck` 컬럼 없음.
- thesisStore: consensus_score별 적중률 집계 쿼리 없음.
- 통계: 합의도(4/4, 3/4, 2/4)와 적중률(CONFIRMED율)의 상관관계 파악 불가.

**After**

- 라운드3 프롬프트: "현재 병목이 해소된다면 다음 제약은 어디인가?" 질문 추가. 모더레이터가 `next_bottleneck`을 thesis JSON에 포함.
- theses 테이블: `consensus_score` (`integer`, 4/3/2로 저장), `dissent_reason` (`text`), `next_bottleneck` (`text`) 컬럼 추가.
- thesisStore: `getConsensusByHitRate()` — consensus_score별 CONFIRMED율 집계 쿼리 추가.
- 축적 데이터: 4주 후 "3/4가 더 높은가, 4/4가 더 높은가" 가설 검증 가능.

---

## 변경 사항

### N-1c: N+1 병목 예측

1. **`src/agent/debate/round3-synthesis.ts`**
   - `buildSynthesisPrompt`: thesis JSON 스키마에 `"nextBottleneck"` 필드 추가.
   - 모더레이터 지시: `structural_narrative` 카테고리 thesis에 대해 "현재 병목이 해소된다면 공급 체인의 다음 제약은 어디인가? 해당 없으면 null" 작성 지시.
   - `isValidThesis`: `nextBottleneck` 필드를 optional로 처리 (없어도 통과).
   - `normalizeThesisCategory` 옆에 `normalizeNextBottleneck` 추가 — null/undefined를 명시적으로 null로 정규화.

2. **`src/db/schema/analyst.ts`**
   - `theses` 테이블에 `nextBottleneck: text("next_bottleneck")` 컬럼 추가 (nullable).

3. **`src/agent/debate/thesisStore.ts`**
   - `saveTheses`: insert rows에 `nextBottleneck` 포함.

4. **`src/types/debate.ts`**
   - `Thesis` 인터페이스에 `nextBottleneck?: string | null` 추가.

5. **DB 마이그레이션** — `theses.next_bottleneck text` 컬럼 추가.

### N-1d: 합의도 추적

6. **`src/db/schema/analyst.ts`**
   - `theses` 테이블에 `consensusScore: integer("consensus_score")` 컬럼 추가 (nullable — 기존 rows 호환).
   - `theses` 테이블에 `dissentReason: text("dissent_reason")` 컬럼 추가 (nullable).
   - 주의: 기존 `consensusLevel` (`"4/4"` 등 문자열)과 신규 `consensusScore` (정수 4/3/2)는 별도 컬럼으로 공존. consensusScore는 consensusLevel의 파생값이지만, 집계 쿼리 편의를 위해 정수로 별도 저장.

7. **`src/agent/debate/round3-synthesis.ts`**
   - `buildSynthesisPrompt`: thesis JSON 스키마에 `"dissentReason"` 필드 추가.
   - 모더레이터 지시: 합의되지 않은 의견이 있을 때 `dissentReason`에 반대 입장 요약 (1~2줄). 만장일치면 null.
   - `isValidThesis`: `dissentReason`을 optional로 처리.

8. **`src/agent/debate/thesisStore.ts`**
   - `saveTheses`: insert rows에 `consensusScore`, `dissentReason` 포함.
     - `consensusScore` 파생 로직: `consensusLevel` `"4/4"` → 4, `"3/4"` → 3, `"2/4"` → 2, `"1/4"` → 1.
   - `getConsensusByHitRate()` 추가: `consensus_score`별 CONFIRMED/INVALIDATED/EXPIRED 수 집계.

9. **`src/types/debate.ts`**
   - `Thesis` 인터페이스에 `dissentReason?: string | null` 추가.
   - `consensusScore?: number` 추가 (저장 시 파생, 입력 타입에는 optional).

10. **DB 마이그레이션** — `theses.consensus_score integer`, `theses.dissent_reason text` 컬럼 추가.

---

## 작업 계획

### 태스크 1 — DB 스키마 + 마이그레이션 [실행팀]

**변경 파일:**
- `src/db/schema/analyst.ts`: `theses` 테이블에 3개 컬럼 추가
  - `nextBottleneck: text("next_bottleneck")` (nullable)
  - `consensusScore: integer("consensus_score")` (nullable)
  - `dissentReason: text("dissent_reason")` (nullable)
- `src/types/debate.ts`: `Thesis` 인터페이스에 `nextBottleneck`, `dissentReason` optional 필드 추가. `consensusScore` 제외 (저장 시 파생값이므로 타입에는 불필요).

**완료 기준:**
- `drizzle-kit generate` 실행 후 마이그레이션 SQL 파일 생성.
- `drizzle-kit migrate` 실행 후 Supabase DB에 컬럼 적용 확인.
- 기존 rows는 3개 컬럼 모두 null — 기존 기능 영향 없음.

**의존성:** 없음 (독립 태스크).

---

### 태스크 2 — round3-synthesis 프롬프트 + 추출 로직 수정 [실행팀]

**변경 파일:** `src/agent/debate/round3-synthesis.ts`

**완료 기준 (N-1c):**
- `buildSynthesisPrompt`의 thesis JSON 스키마 예시에 `"nextBottleneck"` 필드 추가.
  ```json
  "nextBottleneck": "광트랜시버 대역폭 제한"
  ```
- `structural_narrative` thesis에 대한 N+1 병목 질문 지시 추가:
  ```
  nextBottleneck: 현재 병목이 해소된다면 공급 체인에서 다음으로 제약이 될 노드는?
  structural_narrative 카테고리에만 작성. 해당 없거나 다른 카테고리면 null.
  ```
- `isValidThesis`에서 `nextBottleneck` 필드를 optional로 처리 (존재하지 않아도 통과).
- `extractThesesFromText` — 파싱 후 `nextBottleneck: null` 정규화 (undefined → null).

**완료 기준 (N-1d):**
- thesis JSON 스키마에 `"dissentReason"` 필드 추가.
  ```json
  "dissentReason": "지정학 분석가: 공급 체인 재편 속도 과대평가 우려"
  ```
- 지시: "합의되지 않은 의견이 있을 경우 `dissentReason`에 반대 입장 1~2줄 요약. 만장일치면 null."
- `isValidThesis`에서 `dissentReason`을 optional로 처리.

**의존성:** 태스크 1 완료 후 진행 (타입 변경 필요).

---

### 태스크 3 — thesisStore 수정 [실행팀]

**변경 파일:** `src/agent/debate/thesisStore.ts`

**완료 기준:**

`saveTheses` 수정:
- insert rows에 `nextBottleneck`, `dissentReason` 포함.
- `consensusScore` 파생 로직 추가:
  ```typescript
  function parseConsensusScore(level: ConsensusLevel): number {
    const [num] = level.split("/");
    return parseInt(num, 10);
  }
  ```
- insert rows에 `consensusScore: parseConsensusScore(t.consensusLevel)` 포함.

`getConsensusByHitRate()` 함수 추가:
```typescript
// 반환: [{ consensusScore: 4, confirmed: N, invalidated: N, expired: N, total: N }]
export async function getConsensusByHitRate(): Promise<ConsensusHitRateRow[]>
```
- `consensus_score`별 `status` 집계 쿼리.
- `consensus_score IS NOT NULL` 조건 (기존 rows 제외).
- 반환 타입 `ConsensusHitRateRow`는 `src/types/debate.ts`에 추가.

**의존성:** 태스크 1 완료 후 진행.

---

### 태스크 4 — 테스트 추가/업데이트 [실행팀]

**변경 파일:** `src/agent/debate/__tests__/round3-synthesis.test.ts` (또는 동등 위치)

**완료 기준:**

N-1c 테스트:
- `extractThesesFromText`: `nextBottleneck` 필드가 있는 JSON 파싱 성공.
- `extractThesesFromText`: `nextBottleneck`이 없는 JSON도 통과 (optional).
- `isValidThesis`: `nextBottleneck: null`인 thesis도 valid.

N-1d 테스트:
- `extractThesesFromText`: `dissentReason` 필드 파싱 성공.
- `extractThesesFromText`: `dissentReason: null`인 thesis도 valid.

thesisStore 테스트:
- `parseConsensusScore("3/4")` → 3, `"4/4"` → 4, `"2/4"` → 2.
- `saveTheses` mock: `consensusScore` 파생값이 올바르게 포함되는지 확인.

**완료 기준 (수치):**
- 기존 555개 테스트 통과.
- N-1c/N-1d 관련 신규 테스트 최소 8개 추가.
- 전체 커버리지 80% 이상 유지.

**의존성:** 태스크 2, 3 완료 후 진행.

---

## 병렬 실행 계획

```
태스크 1 (DB 스키마 + 마이그레이션)
       │
       ├── 태스크 2 (round3 프롬프트 + 추출 로직)  ──┐
       └── 태스크 3 (thesisStore 수정)              ──┤
                                                      │
                                              태스크 4 (테스트)
```

태스크 1 완료 후, 태스크 2와 태스크 3은 병렬 실행 가능.
태스크 4는 태스크 2, 3 완료 후 진행.

---

## 리스크

1. **consensusLevel vs consensusScore 이중화**: 기존 `consensusLevel` 문자열과 신규 `consensusScore` 정수가 공존한다. 파생값이므로 정합성 문제는 없지만, 미래에 중복 관리 부담이 생긴다. 현재는 DB 쿼리 편의를 위해 정수 컬럼을 추가하는 것이 합리적이며, 데이터가 충분히 축적된 후 `consensusLevel` 컬럼을 뷰로 대체하는 리팩토링은 Wave 3 이후 검토.

2. **next_bottleneck 추론 신뢰도**: LLM이 공급 체인 다음 노드를 추론할 때 학습 데이터에 있는 알려진 체인(GPU → 메모리 → 광통신)은 정확하게 도출하지만, 새로운 병목은 도출 못할 수 있다. 기대치를 "새로운 발견"이 아니라 "알려진 구조의 체계적 정리"로 설정. 오분류는 데이터 정합성 문제이지 시스템 장애가 아님.

3. **dissentReason LLM 일관성**: 모더레이터가 반대 의견 요약을 생략하거나 과도하게 장문으로 작성할 수 있다. `isValidThesis`에서 길이 제한 (maxLength: 300자 권장, 강제하지 않음)을 명시하면 완화 가능.

4. **기존 rows와의 집계 혼재**: 기존 rows는 `consensus_score = NULL`이다. `getConsensusByHitRate()`에서 `IS NOT NULL` 조건으로 필터링하므로 기존 데이터 오염 없음. 단, 집계 결과에 기존 rows가 제외되어 초기에는 샘플 수가 적다. 통계적 유의성은 4주+ 축적 후 판단.

5. **마이그레이션 충돌**: PR #82와 현재 브랜치가 모두 `theses` 테이블을 수정했다. PR #82가 main에 머지된 상태에서 진행하므로, 현재 `src/db/schema/analyst.ts`의 최신 상태를 기준으로 마이그레이션을 생성해야 한다. 태스크 1 시작 전 `git pull origin main` 필수.

---

## 의사결정 필요

없음 — 바로 구현 가능.

RFC의 제안 1-F와 제안 9가 명확하고, 구현 방식(optional 필드 추가, 파생 정수 컬럼, 집계 쿼리)이 기존 인프라와 충돌하지 않는다.
