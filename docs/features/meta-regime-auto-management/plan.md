# 메타 레짐 자동 관리 — 생성/상태 전이/체인 연결

## 선행 맥락

없음 — 메모리에 이 주제에 대한 선행 결정/교훈 없음.

#735에서 구현된 것:
- `meta_regimes` 테이블 스키마 (id, name, description, propagationType, status, activatedAt, peakAt)
- `narrative_chains.metaRegimeId`, `sequenceOrder`, `sequenceConfidence` 컬럼
- `metaRegimeService.ts` — `createMetaRegime`, `getActiveMetaRegimes`, `getMetaRegimeWithChains`, `formatMetaRegimesForPrompt` (읽기 전용)
- `run-debate-agent.ts` 4.7 단계에서 국면 컨텍스트를 로드하여 Round 3 프롬프트에 주입

현재 상태:
- 쓰기(생성/갱신/전이)가 전혀 없음 — 시드 데이터를 수동 SQL로 관리 중
- `narrativeChainService.recordNarrativeChain`에서 체인 생성/갱신 시 `metaRegimeId`를 절대 세팅하지 않음
- `thesisStore.saveTheses` → `recordNarrativeChain` 호출 흐름은 있지만 메타 레짐 연결이 누락됨

## 골 정렬

**ALIGNED** — 메타 레짐은 Phase 2 초입 포착의 상위 구조적 맥락이다. 수동 SQL 관리는 CEO 부담이고, 연결되지 않은 국면 정보는 프롬프트 주입 효과가 절반에 그친다. 자동화가 완성되면 에이전트가 "현재 체인이 국면 내 몇 번째 파동인지"를 실시간으로 파악할 수 있어 조기 포착 정밀도가 높아진다.

## 문제

토론 에이전트가 매일 narrative chain을 생성/갱신하지만, meta_regime(국면) 레이어에는 전혀 쓰지 않는다. 결과적으로 국면은 수동 SQL 없이 생성되지 않고, 체인과 국면의 연결(`metaRegimeId`)도 자동으로 세팅되지 않는다.

## Before → After

**Before**
- 국면 생성: DBA가 수동 SQL INSERT
- 체인↔국면 연결: 없음 (`narrative_chains.meta_regime_id = NULL`)
- 국면 상태 전이: 없음 (ACTIVE 고정)
- 에이전트 프롬프트: 국면 이름/설명은 보이지만 어떤 체인이 그 안에 속하는지 연결이 안 됨

**After**
- 국면 생성: Round 3 완료 후 자동 판단 — 임계 충족 시 `createMetaRegime` 호출
- 체인↔국면 연결: 체인 생성/갱신 시 활성 국면과 매칭하여 `metaRegimeId` + `sequenceOrder` 자동 세팅
- 국면 상태 전이: 토론 완료 후 체인 상태 집계 → 자동 전이 (ACTIVE → PEAKED → RESOLVED)
- 에이전트 프롬프트: 체인이 국면 내 순서대로 연결되어 "이 국면의 1→2→3파동" 서사가 완성됨

## 변경 사항

### 1. `src/debate/metaRegimeService.ts` 확장

추가 함수:

```typescript
// 국면 상태 전이
export async function transitionMetaRegimeStatus(
  regimeId: number,
  newStatus: MetaRegimeStatus,
): Promise<void>

// 국면 description 업데이트
export async function updateMetaRegimeDescription(
  regimeId: number,
  description: string,
): Promise<void>

// 체인 → 국면 연결
export async function linkChainToMetaRegime(
  chainId: number,
  regimeId: number,
  sequenceOrder: number,
): Promise<void>

// 국면 내 체인 상태 집계 → 자동 전이 판정
export async function syncMetaRegimeStatus(regimeId: number): Promise<{
  regimeId: number;
  previousStatus: MetaRegimeStatus;
  newStatus: MetaRegimeStatus;
  changed: boolean;
}>

// 이름 유사도 기반 중복 국면 조회
export async function findSimilarMetaRegime(
  name: string,
  megatrends: string[],
): Promise<{ id: number; name: string } | null>
```

상태 전이 규칙 (결정론적):
- 국면 내 ACTIVE/RESOLVING 체인 >= 1개 → 국면 ACTIVE 유지
- 국면 내 모든 체인이 PEAKED 이상 → 국면 PEAKED
- 국면 내 모든 체인이 RESOLVED/OVERSUPPLY → 국면 RESOLVED
- 국면에 연결된 체인이 0개면 전이 없음 (고아 국면)

### 2. `src/debate/narrativeChainService.ts` 수정

`recordNarrativeChain` 내부 — 새 체인 생성 시:
1. `getActiveMetaRegimes()` 호출로 현재 활성 국면 목록 조회
2. 체인의 `megatrend` 키워드와 국면 이름/description 키워드 overlap 계산
3. overlap >= MIN_KEYWORD_OVERLAP(2)인 국면 중 best match → `metaRegimeId` 세팅
4. `sequenceOrder` = 해당 국면 내 기존 체인 수 + 1 자동 할당

기존 체인 업데이트 시: `metaRegimeId`가 NULL이면 위 매칭 재시도.

### 3. `src/agent/run-debate-agent.ts` 수정

Step 6 이후 Step 6.8 추가:

```
// 6.8. 메타 레짐 상태 동기화
for each active meta regime:
  await syncMetaRegimeStatus(regime.id)
  if changed: log

// 6.9. 신규 국면 생성 판단
await evaluateNewMetaRegime(newChains, debateDate)
```

`evaluateNewMetaRegime` 로직 (결정론적 게이트):
- 오늘 새로 생성된 체인 목록 중 `metaRegimeId == null`인 체인만 대상
- megatrend 키워드 그루핑 → 동일 거시 동인으로 묶인 체인 2개 이상이면 국면 생성 후보
- `findSimilarMetaRegime()`로 기존 국면과 중복 체크 → 중복이면 기존 국면에 연결
- 중복 아니면 `createMetaRegime()` 호출 후 해당 체인들에 `linkChainToMetaRegime()` 적용
- 국면 이름은 프로그래밍으로 megatrend 공통 키워드에서 추출 (LLM 불필요)

### 4. 모더레이터 프롬프트 변경 — 불필요

국면 생성/연결 판단은 전부 프로그래밍으로 처리한다. LLM에게 "국면을 생성하라"고 지시하면 남발 위험이 있고 결정론적 제어가 불가능하다. 프롬프트는 수정하지 않는다.

## 작업 계획

### Step 1 — metaRegimeService 쓰기 함수 추가
- 파일: `src/debate/metaRegimeService.ts`
- 함수: `transitionMetaRegimeStatus`, `updateMetaRegimeDescription`, `linkChainToMetaRegime`, `syncMetaRegimeStatus`, `findSimilarMetaRegime`
- 완료 기준: 각 함수 단위 테스트 통과

### Step 2 — 체인↔국면 자동 연결
- 파일: `src/debate/narrativeChainService.ts`
- 변경: `recordNarrativeChain`에서 신규/기존 체인 모두 국면 매칭 로직 추가
- 완료 기준: 새 체인 생성 시 `metaRegimeId`가 자동으로 세팅됨 확인 (DB 조회)

### Step 3 — 국면 상태 동기화 + 신규 국면 생성
- 파일: `src/agent/run-debate-agent.ts`
- 변경: Step 6.8, 6.9 추가
- 완료 기준: 토론 실행 후 국면 상태 로그 출력, 조건 충족 시 신규 국면 생성 로그

### Step 4 — 통합 테스트
- 파일: `src/debate/__tests__/metaRegimeAutoManagement.test.ts` (신규)
- 테스트 시나리오:
  - 체인 2개 + 동일 megatrend → 국면 자동 생성
  - 체인 3개 중 2개 RESOLVED → 국면 PEAKED 전이 (1개 ACTIVE 남음)
  - 체인 3개 전부 RESOLVED → 국면 RESOLVED 전이
  - 이름 유사 국면 존재 → 신규 생성 안 하고 기존 국면에 연결
  - 체인 수 < 2 → 국면 생성 안 함

## LLM vs 프로그래밍 분리

| 로직 | 처리 방식 | 이유 |
|------|-----------|------|
| 국면 생성 판단 (임계 충족 여부) | 프로그래밍 | 결정론적 제어 필요, 남발 방지 |
| 체인↔국면 매칭 | 프로그래밍 (키워드 overlap) | findMatchingChain과 동일 패턴, 검증됨 |
| 국면 상태 전이 | 프로그래밍 | 규칙이 명확함, 오버엔지니어링 금지 |
| 국면 이름 생성 | 프로그래밍 (megatrend 키워드) | LLM 개입 불필요한 영역 |
| sequenceOrder 할당 | 프로그래밍 | 단순 카운트 |
| description 갱신 (선택) | 미구현 | 빈도 낮음, 초기 구현에서 제외 |

## 국면 남발 방지 메커니즘

1. **수량 게이트**: `metaRegimeId == null` 체인이 2개 이상 동일 거시 동인으로 묶일 때만 국면 생성
2. **중복 방지**: `findSimilarMetaRegime()` — 이름 키워드 overlap(기존 국면 이름 + description과 비교) >= 3이면 기존 국면 재사용
3. **오늘 신규 체인만 대상**: 기존 체인(이미 국면 연결됨)은 신규 국면 생성 평가에서 제외
4. **ACTIVE 국면 이름 중복 금지**: 같은 이름의 ACTIVE 국면이 있으면 절대 중복 생성 안 함 (unique constraint 고려)

## 리스크

1. **키워드 매칭 한계**: megatrend 문자열이 날마다 LLM 표현이 달라질 수 있음 → MIN_KEYWORD_OVERLAP = 2로 설정해 너무 엄격하지 않게 유지. 매칭 실패하면 `metaRegimeId = NULL`로 남김 (에러 아님).

2. **고아 국면**: 생성됐지만 체인이 하나도 연결 안 된 국면 → syncMetaRegimeStatus에서 체인 0개 국면은 전이하지 않으므로 고아 국면이 ACTIVE로 영구 잔류할 수 있음 → 로그 경고로 탐지. 별도 클린업은 초기 구현 범위 밖.

3. **레이스 컨디션**: 토론 완료 후 체인 레코딩 중간에 syncMetaRegimeStatus가 실행되는 문제 → Step 6 (saveTheses + recordNarrativeChain 전부 완료) 이후에 6.8, 6.9 순서대로 실행하므로 문제 없음.

4. **기존 수동 시드 데이터**: 현재 DB에 수동으로 삽입된 국면이 있다면 체인이 연결 안 된 상태일 수 있음 → `metaRegimeId = NULL`인 기존 활성 체인들은 6.9 국면 생성 평가 시 대상이 됨. 단 기존 수동 국면과 키워드 매칭이 되면 자동으로 연결됨.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 구현 중 확인 필요한 사항:
- DB에 현재 수동 삽입된 국면이 있다면 체인 키워드가 매칭될 것인지 사전 검토 권장.
- MIN_KEYWORD_OVERLAP = 2 vs 3 튜닝은 첫 배포 후 실제 매칭률 보고 조정.
