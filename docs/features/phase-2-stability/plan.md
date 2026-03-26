# Plan: Phase 2 판정 경계 안정성 확인

## 문제 정의

90일간 추천 12건 중 6건(50%)이 진입 1-2일 만에 Phase 3으로 전환, 평균 -15% 손실.
공통 원인: 7/8 경계에서 Phase 2를 겨우 충족한 종목이 하루 만에 조건 하나 깨지며 즉시 이탈.

### 근본 원인 2가지

1. **`findPhase2Persistence` 쿼리 버그**: `phase >= 2` 조건이 Phase 3, 4까지 포함하여 지속성 검사가 무력화됨. Phase 3이던 종목이 하루만 Phase 2를 찍어도 기존 Phase 3 기록이 "지속성"으로 카운트됨.
2. **비연속 허용**: "5일 중 3일" 체크는 Phase 2 → 3 → 2 → 3 → 2 같은 불안정 패턴도 통과시킴.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 지속성 쿼리 | `phase >= 2` (Phase 3/4 포함 버그) | `phase = 2` (Phase 2만 카운트) |
| 안정성 체크 | 없음 | 최근 3거래일 연속 Phase 2 필수 |
| 차단 로그 | `blockedByPersistence` | `blockedByPersistence` + `blockedByStability` |

## 변경 사항

### 1. `findPhase2Persistence` 쿼리 수정 (버그 픽스)

**파일**: `src/db/repositories/recommendationRepository.ts`

- `phase >= 2` → `phase = 2`
- 기존 동작: Phase 2, 3, 4 모두 카운트 → Phase 3 종목도 지속성 통과
- 수정 후: Phase 2만 카운트 → 실제 Phase 2 유지 일수 정확히 반영

### 2. `findPhase2Stability` 신규 함수 추가

**파일**: `src/db/repositories/recommendationRepository.ts`, `src/db/repositories/types.ts`

- 최근 N 거래일의 phase를 조회하여 모두 Phase 2인 symbol만 반환
- SQL: `ROW_NUMBER() OVER (ORDER BY date DESC)` 로 최근 N일 추출 후 `HAVING COUNT(*) FILTER (WHERE phase = 2) = N`

### 3. `saveRecommendations` 안정성 게이트 추가

**파일**: `src/tools/saveRecommendations.ts`

- `PHASE2_STABILITY_DAYS = 3` 상수 추가 (최근 3거래일 연속 Phase 2 필수)
- `findPhase2Stability` 병렬 조회 추가 (기존 persistence 쿼리와 함께)
- 안정성 미충족 시 `blockedByStability++` 후 차단
- 기존 persistence 게이트는 유지 (쿼리 버그만 수정)

### 4. 테스트

- 기존 persistence 테스트 업데이트
- 안정성 게이트 차단/통과 테스트 추가

## 작업 계획

1. `recommendationRepository.ts` — `phase >= 2` → `phase = 2` 수정
2. `types.ts` — `Phase2StabilityRow` 타입 추가
3. `recommendationRepository.ts` — `findPhase2Stability` 함수 추가
4. `saveRecommendations.ts` — 안정성 게이트 추가
5. 테스트 작성 및 실행

## 리스크

| 리스크 | 완화 |
|--------|------|
| 기존 persistence 쿼리 수정으로 추천 수 감소 | 의도된 동작. Phase 3 종목의 거짓 통과를 차단하는 것이 목적 |
| 안정성 3일 조건이 너무 엄격 | 3일은 최소 수준. 기존 persistence도 3일 기준. 추후 데이터로 조정 가능 |
| stock_phases 데이터 부족 (신규 종목) | 데이터 부족 시 stability 결과가 빈 배열 → 자동 차단 (안전 방향) |

## 골 정렬

- **판정**: ALIGNED
- **근거**: Phase 2 초입 포착 정확도 향상은 프로젝트 핵심 목표. false positive 50% 감소 직결.

## 무효 판정

- **해당 없음**: LLM 백테스트, 과최적화 패턴 아님. DB 쿼리 버그 수정 + 순수 데이터 기반 필터 추가.
