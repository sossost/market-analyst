# Plan: Phase 1 Late 진입 필터 ma150_slope 강화

## 문제 정의

`stockPhaseRepository.ts`의 `findPhase1LateStocks` SQL에서 `ma150_slope > -0.001` 조건이 하락 감속(deceleration)을 안정화(stabilization)로 오판한다.

- slope -0.0009 (MA150이 여전히 하락 중) → 필터 통과
- 90일간 Phase 1 Late → Phase 2 전환 11건 전패 (승률 0%)
- Phase Exit 6건 평균 2일 만에 Phase 3 이탈, 평균 PnL -15%

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| ma150_slope 조건 | `> -0.001` (음수 허용) | `>= 0` (양전환만 허용) |
| 통과 기준 | 하락 감속도 통과 | 진정한 안정화/반전만 통과 |
| description 문구 | "기울기 > -0.001" | "기울기 >= 0" |

## 변경 사항

### 1. `src/db/repositories/stockPhaseRepository.ts` line 311
- `AND sp.ma150_slope::numeric > -0.001` → `AND sp.ma150_slope::numeric >= 0`

### 2. `src/tools/getPhase1LateStocks.ts`
- 주석 업데이트: "기울기 > -0.001" → "기울기 >= 0"
- description 문구 업데이트

### 3. 테스트 업데이트
- SQL 패턴 검증 테스트가 `> -0.001`을 기대하는 경우 `>= 0`으로 수정
- slope 음수 케이스가 통과하지 않음을 검증하는 테스트 추가

## 범위 외 (별도 이슈)

- RS 하한 30 → 40 상향 (slope 수정 효과를 먼저 측정)
- slope 가속도 조건 추가 (데이터 가용성 확인 필요)
- 과거 데이터 백테스트

## 골 정렬

**ALIGNED** — Phase 2 초입 포착 정확도가 0%인 상태에서, 진입 필터를 엄격히 하는 것이 포착 범위 확대보다 우선.

## 무효 판정

**유효** — 90일간 11건 전패는 필터의 구조적 결함을 입증. 하락 중인 종목(slope < 0)이 Phase 2 후보로 올라가는 것을 차단하는 것은 합리적.

## 리스크

- Phase 2 후보 수 감소 가능 → forward-looking 성과로 검증 (정확도 개선이 목적이므로 의도된 결과)
- slope가 정확히 0인 종목이 경계에 걸림 → `>=`이므로 포함됨, 문제 없음
