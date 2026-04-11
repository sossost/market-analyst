# 기획서: 메타 레짐 자동 관리 — 생성/상태 전이/체인 연결

> Issue: #743 | Branch: `feat/issue-743`

## 문제 정의

#735에서 메타 레짐 데이터 모델 + 프롬프트 읽기(formatMetaRegimesForPrompt)는 구현됐지만,
쓰기(생성/갱신/상태 전이)가 없다. 시드 데이터를 수동 SQL로 관리 중이며 국면 변화 시 CEO 개입이 필요하다.

## 골 정렬

- **판정: SUPPORT**
- 메타 레짐은 복수 narrative chain을 거시 동인으로 묶는 상위 계층
- 자동 관리가 되면 토론 에이전트가 구조적 테마 변화를 자율 추적 가능
- Phase 2 초입 포착의 맥락 품질 향상 (간접 기여)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 국면 생성 | 수동 SQL INSERT | 2+ 체인이 같은 megatrend로 묶이면 자동 생성 |
| 상태 전이 | 없음 | 체인 상태 집계로 ACTIVE→PEAKED→RESOLVED 자동 전이 |
| 체인↔국면 연결 | 수동 UPDATE | 미연결 체인을 megatrend 키워드 매칭으로 자동 연결 |

## 설계 결정

### 1. 상태 전이: 코드 규칙 (LLM 아님)

국면 상태는 하위 체인들의 상태 집계로 결정한다:
- **ACTIVE 유지**: 1개 이상의 체인이 ACTIVE
- **→ PEAKED**: 모든 체인이 ACTIVE가 아닌 상태 (RESOLVING/RESOLVED/OVERSUPPLY/INVALIDATED)
- **→ RESOLVED**: 모든 체인이 RESOLVED 또는 INVALIDATED

순수 함수 `determineRegimeStatus()`로 추출하여 단위 테스트 가능.

### 2. 체인↔국면 연결: 코드 매칭 (LLM 아님)

기존 `findMatchingChain()`과 동일한 키워드 오버랩 방식 사용.
미연결 체인의 megatrend 키워드 vs 국면 내 기존 체인들의 megatrend 키워드.
최소 2개 키워드 겹침 시 연결. sequence_order는 기존 최대값 + 1.

### 3. 국면 자동 생성: 코드 규칙 (LLM 아님)

미연결 ACTIVE 체인들을 megatrend 키워드로 그룹핑.
2개 이상 체인이 같은 그룹이면 국면 자동 생성.
- name: 그룹 내 첫 번째 체인의 megatrend
- propagationType: supplyChain에 "→" 포함 시 supply_chain, 아니면 narrative_shift

국면 남발 방지: 최소 2개 체인 필수. 1개 체인으로는 국면 생성 안 함.

### 4. 모더레이터 프롬프트 변경 없음

1차 구현에서는 프롬프트를 수정하지 않는다.
체인의 megatrend 필드가 이미 충분히 구조화되어 있어 코드 매칭으로 충분.
description 갱신도 후순위로 제외.

## 변경 사항

### `src/debate/metaRegimeService.ts` (확장)
- `determineRegimeStatus()` — 순수 함수. 체인 상태 배열 → 국면 상태 반환.
- `transitionMetaRegimeStatuses()` — 모든 ACTIVE 국면 순회, 상태 전이 적용.
- `linkChainToRegime()` — 특정 체인을 국면에 연결 (metaRegimeId, sequenceOrder 설정).
- `linkUnlinkedChainsToRegimes()` — 미연결 체인 자동 매칭 + 연결.
- `detectAndCreateNewRegimes()` — 미연결 체인 그룹핑 → 2+ 시 국면 생성.
- `manageMetaRegimes()` — 오케스트레이터. 위 3개를 순서대로 실행.

### `src/agent/run-debate-agent.ts` (수정)
- Step 6 (thesis 저장) 이후에 `manageMetaRegimes()` 호출 추가.
- 에러 격리: try/catch로 감싸서 국면 관리 실패가 토론 전체를 중단시키지 않음.

### `__tests__/debate/metaRegimeService.test.ts` (확장)
- determineRegimeStatus 단위 테스트 (순수 함수)
- transitionMetaRegimeStatuses 통합 테스트 (DB mock)
- linkUnlinkedChainsToRegimes 통합 테스트
- detectAndCreateNewRegimes 통합 테스트

## 작업 계획

1. metaRegimeService.ts 확장 — 순수 함수 먼저, DB 연동 후
2. run-debate-agent.ts 수정 — manageMetaRegimes 호출 추가
3. 테스트 작성 + 실행
4. 코드 리뷰 + 문서 업데이트

## 리스크

| 리스크 | 대응 |
|--------|------|
| 키워드 매칭 정확도 | megatrend는 짧고 특화된 텍스트라 keyword overlap으로 충분. 부족하면 2차에서 LLM 판단 추가 |
| 국면 남발 | 최소 2개 체인 필수 + 같은 체인이 두 국면에 속하지 않도록 제약 |
| 상태 전이 부작용 | PEAKED→ACTIVE 역전이 없음. 단방향 전이만 허용 |
| 토론 파이프라인 영향 | manageMetaRegimes는 에러 격리. 실패해도 thesis 저장은 완료된 상태 |

## 무효 판정

- 해당 없음. 기존 시스템 간섭 없음. DB 마이그레이션 불필요.
