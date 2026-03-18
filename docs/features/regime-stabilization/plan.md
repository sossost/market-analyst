# 레짐 안정화 2단계 — 전환 제약 + null 정합성

GitHub Issue #289

## 선행 맥락

`docs/features/regime-hysteresis/plan.md` (2026-03-10, PR #270):
- CONFIRMATION_DAYS=2 히스테리시스를 도입하여 1단계 안정화를 구현함
- 당시 판단: "2는 노이즈 제거와 반응 속도 사이의 최소 절충점. 데이터 축적 후 조정 가능"
- 리스크 섹션에 명시: "레짐 전환 지연 2일 — 수용 가능한 트레이드오프"

실운영 결과(이슈 #289):
- 5일간 레짐 4회 변경: MID_BULL → LATE_BULL → EARLY_BULL → LATE_BULL → EARLY_BEAR
- LATE_BULL → EARLY_BULL → LATE_BULL처럼 논리적으로 불가능한 전환이 허용됨
- CONFIRMATION_DAYS=2는 1일 갭으로 뒤집힘 — 노이즈 제거 효과 불충분
- 추천 14건 중 8건의 `market_regime`이 null — 레짐 확정 전 추천이 저장되는 구조적 결함

`docs/features/market-regime/01-spec.md`에서 RFC 메모로 예고된 위험이 재발현.

## 골 정렬

ALIGNED — Phase 2 초입 포착의 전제는 시장 국면 판단의 신뢰성이다. 레짐이 불안정하면 다음이 무너진다:
1. EARLY_BEAR/BEAR에서 Bear Gate가 발동하지 않거나 과도하게 발동하여 추천 품질이 저하됨
2. 추천 레코드에 `market_regime=null`이면 성과 분석 시 레짐 조건부 검증이 불가능해짐
3. LLM에 주입되는 레짐 컨텍스트가 불안정하면 토론 품질 자체가 흔들림

## 문제

CONFIRMATION_DAYS=2가 실전에서 충분하지 않다. 하루라도 다른 레짐이 끼어들면 카운터가 리셋되므로, 시장이 애매한 구간에서 계속 진동해도 확정이 이루어진다. 또한 물리적으로 불가능한 전환(LATE_BULL→EARLY_BULL처럼 역행 전환)을 제약하는 로직이 없다. 추가로 `saveRecommendations.ts`가 `loadConfirmedRegime()`를 호출하지만, 레짐 저장과 추천 저장 순서가 명시적으로 보장되지 않아 `market_regime=null` 레코드가 발생한다.

## Before → After

**Before**
- `CONFIRMATION_DAYS = 2`: 연속 2일이면 확정 — 노이즈에 취약
- 전환 제약 없음: LATE_BULL → EARLY_BULL처럼 역행 전환 허용
- 추천 저장 시 `loadConfirmedRegime()` 실패하거나 아직 pending이면 `market_regime=null`로 저장
- EARLY_BEAR 레짐이 확정되지 않은 채 pending 상태일 때 Bear Gate 미작동 가능

**After**
- `CONFIRMATION_DAYS = 3` (또는 4): 실전 노이즈를 흡수할 수 있는 수준
- 허용 전환 맵: 논리적으로 인접한 전환만 수용. 역행 전환 시도 시 pending 저장 자체를 거부
- 추천 저장 시 `market_regime`이 null이면 직전 confirmed 레짐을 fallback으로 사용 — null 레코드 0건 목표
- 레짐 분류기 안정성이 추천 품질과 리포트 품질에 전파되지 않음

## 변경 사항

### T1. CONFIRMATION_DAYS 상향 조정

**파일**: `src/agent/debate/regimeStore.ts`

`CONFIRMATION_DAYS` 상수를 2에서 3으로 변경.

변경 시 `windowDays` 계산식(`(CONFIRMATION_DAYS - 1) * MAX_GAP_DAYS + 1`)과 DB 조회 `limit`이 자동으로 연동되므로 별도 로직 수정 없음. `formatRegimeForPrompt`의 "X일 더 연속되면 확정" 계산도 자동 반영.

**수용 기준**:
- `CONFIRMATION_DAYS = 3` 상수 적용
- 기존 단위 테스트에서 "2일 연속 동일 → 확정" 케이스가 실패로 바뀌어야 함 (회귀 감지 확인)
- "3일 연속 동일 → 확정" 테스트 케이스 추가하여 통과 확인

### T2. 레짐 전환 제약 맵 구현

**파일**: `src/agent/debate/regimeStore.ts`

논리적으로 허용되는 전환만 수용하는 화이트리스트 구조를 구현한다.

허용 전환 맵:

```
EARLY_BULL  → MID_BULL, EARLY_BEAR
MID_BULL    → LATE_BULL, EARLY_BULL, EARLY_BEAR
LATE_BULL   → MID_BULL, EARLY_BEAR
EARLY_BEAR  → BEAR, LATE_BULL
BEAR        → EARLY_BEAR
```

설계 근거:
- 한 단계씩 이동하는 것만 허용 (LATE_BULL → EARLY_BULL은 두 단계 역행이므로 금지)
- 각 레짐에서 반전(약세 전환 또는 회복) 방향으로 1단계 이동은 허용
- EARLY_BULL → BEAR처럼 두 단계 이상 도약도 금지

구현 위치: `applyHysteresis` 내부에서 전환 허용 여부 검증. 허용되지 않은 전환이 CONFIRMATION_DAYS를 채웠더라도 확정 거부. 단, 현재 confirmed 레짐이 없는 초기 상태에서는 전환 제약 미적용(어떤 레짐이든 첫 확정 허용).

**수용 기준**:
- 허용 전환 케이스(LATE_BULL → EARLY_BEAR 3일 연속) → 확정됨
- 금지 전환 케이스(LATE_BULL → EARLY_BULL 3일 연속) → 확정 거부, 이전 confirmed 유지
- 초기 상태(confirmed=null)에서는 어떤 레짐이든 확정 허용

### T3. 추천 저장 시 market_regime null 방지

**파일**: `src/agent/tools/saveRecommendations.ts`

현재 코드: `currentRegime = confirmed?.regime ?? null`

null일 경우 fallback 로직 추가:
- `loadConfirmedRegime()`이 null을 반환하면 `loadPendingRegimes(1)`을 추가 호출하여 가장 최근 pending 레짐을 사용
- pending도 없으면 `market_regime = null`로 저장 (어쩔 수 없는 케이스, 로그 경고)

이 변경으로 레짐 시스템 초기화 직후를 제외하면 `market_regime=null` 레코드가 발생하지 않는다.

**수용 기준**:
- confirmed 레짐 있음 → `market_regime = confirmed.regime`
- confirmed 없음, pending 있음 → `market_regime = pending[0].regime`
- 둘 다 없음 → `market_regime = null` (경고 로그 출력)
- 단위 테스트 3개 케이스 통과

### T4. 테스트 업데이트

**파일**: `src/agent/debate/__tests__/regimeHysteresis.test.ts`

T1, T2 변경에 따른 기존 테스트 수정 및 신규 케이스 추가:

신규 추가 테스트:
1. "3일 연속 동일 레짐 → 확정" (T1 기준 변경 검증)
2. "2일 연속 동일 레짐 → 확정 안 됨" (T1 회귀 방지)
3. "허용 전환(LATE_BULL → EARLY_BEAR) 3일 연속 → 확정됨" (T2 정상 동작)
4. "금지 전환(LATE_BULL → EARLY_BULL) 3일 연속 → 확정 거부, 이전 confirmed 반환" (T2 핵심)
5. "초기 상태에서 금지 전환도 허용" (T2 초기 상태 예외)

**수용 기준**: 전체 테스트 통과 + 커버리지 80% 이상 유지

## 작업 계획

### Phase 1: regimeStore 수정 (T1 + T2)

**담당**: 구현팀
**선행 조건**: 없음
**완료 기준**: T1 수용 기준 + T2 수용 기준 모두 통과

순서:
1. `CONFIRMATION_DAYS = 3`으로 변경
2. `ALLOWED_TRANSITIONS` 맵 상수 선언
3. `applyHysteresis` 내에 전환 제약 검증 로직 삽입 (confirmed → latest pending 전환이 허용 맵에 있는지 확인)
4. 기존 테스트 수정 + 신규 테스트 케이스 추가

### Phase 2: saveRecommendations 수정 (T3)

**담당**: 구현팀
**선행 조건**: Phase 1 완료 불필요 (독립 수정)
**완료 기준**: T3 수용 기준 통과

순서:
1. null일 때 `loadPendingRegimes(1)` fallback 추가
2. 단위 테스트 3개 케이스 작성 및 통과 확인

Phase 1과 Phase 2는 병렬 실행 가능.

## 리스크

**레짐 전환 지연 심화**: CONFIRMATION_DAYS=3은 실제 국면 전환 신호도 3일 지연시킨다. Phase 2 초입 포착이 핵심인 프로젝트에서 3일 지연은 트레이드오프가 있다. 단, 레짐 전환 후 추천/행동은 다음날부터 바뀌는 구조이므로, 레짐이 며칠 늦게 확정되는 것보다 하루하루 뒤집히는 것이 더 치명적이다. 3일로 설정 후 실운영 모니터링을 통해 4일로 올리거나 2일로 내리는 조정 여지를 남긴다.

**전환 제약 맵 설계 오류**: 허용 전환 맵이 실제 시장 구조와 맞지 않으면 유효한 전환도 막힐 수 있다. 예: 급격한 시장 붕괴 시 MID_BULL → BEAR 직접 전환이 발생할 수 있으나 제약에 막힘. 이 케이스는 EARLY_BEAR를 거쳐 전환되도록 LLM 프롬프트에서 1단계씩 이동하도록 안내하는 것이 현실적이다. 구현 후 비정상 레짐 차단 케이스를 로그로 모니터링.

**market_regime null 기존 레코드**: T3은 신규 추천부터 적용된다. 기존 null 레코드 8건은 별도 보정이 필요할 경우 운영 SQL로 처리. 이슈 범위 밖이므로 기획서에는 포함하지 않는다.

## 의사결정 필요

**CONFIRMATION_DAYS 값**: 3으로 결정. 근거: 2는 실전에서 입증된 대로 불충분, 4는 전환 지연이 과도함. 3이 현재 데이터 기반의 최선 절충점. 운영 중 모니터링 후 재조정 가능.

**전환 제약 허용 맵**: 위 T2 섹션의 맵을 기본값으로 채택. LLM이 두 단계 이상 도약하는 판정을 반복하면 이는 레짐 분류기 프롬프트 품질 문제이므로, 별도 이슈로 프롬프트 개선을 다룬다.

**중기 개선(확신 차이 기반 전환 비용, confidence 0-100 수치화)**: 이번 이슈 범위 밖. 별도 이슈로 관리.
