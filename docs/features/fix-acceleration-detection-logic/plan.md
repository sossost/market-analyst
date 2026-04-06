# Plan: getFundamentalAcceleration 가속 판정 로직 결함 수정

## 문제 정의

`isAccelerating()` 함수에 2건의 로직 결함이 있다:

1. **유효 패턴 누락** — strictly monotonic (latest > prev > older) 요구로 재가속 패턴(+35→+30→+40)이 누락됨.
   `fundamental-scorer.ts`의 `checkEpsAcceleration()`은 이미 완화된 기준(latest > avg(prior))을 사용 중이므로 불일치.
2. **저성장 오탐** — prior quarters에 최소 성장률 floor가 없어 +2→+3→+15 같은 저성장 단발 반등이 가속으로 오탐됨.

## 골 정렬

- **ALIGNED** — Phase 2 초입 포착의 정확도에 직접 영향. 누락 줄이고 노이즈 제거.

## Before → After

| 패턴 | Before | After | 이유 |
|------|--------|-------|------|
| +35→+30→+40 (재가속) | FAIL | PASS | latest(40) > avg(35,30)=32.5 |
| +2→+3→+15 (저성장 반등) | PASS | FAIL | prev(3) < MIN_PRIOR_GROWTH(8) |
| +20→+30→+40 (정상 가속) | PASS | PASS | latest(40) > avg(20,30)=25, prev(30) >= 8 |
| +50→+80→+100 (감속) | FAIL | FAIL | 감속이므로 판정 무관 |
| +50→+50→+50 (flat) | FAIL | FAIL | latest(50) > avg(50,50)=50 불성립 |

## 변경 사항

### 파일: `src/tools/getFundamentalAcceleration.ts`

1. **상수 추가**: `MIN_PRIOR_GROWTH = 8` (SEPA 25%의 ~30%, 최소 성장 기반)
2. **`isAccelerating()` 로직 변경**:
   - strictly monotonic → `latest > avg(prev, older)` (fundamental-scorer와 통일)
   - `prev.yoyGrowth >= MIN_PRIOR_GROWTH` 조건 추가 (저성장 오탐 차단)

### 파일: `__tests__/agent/tools/fundamentalAcceleration.test.ts`

기존 테스트 수정 + 새 테스트 추가:
- 재가속 패턴 (+35→+30→+40) 통과 확인
- 저성장 오탐 (+2→+3→+15) 차단 확인
- 기존 정상 가속/감속/flat 테스트 유지

## 작업 계획

1. `isAccelerating()` 로직 수정
2. 테스트 업데이트 및 추가
3. 전체 테스트 통과 확인

## 리스크

- **영향 범위**: `earlyDetectionLoader.ts`에서도 `isAccelerating()`을 사용하지만, 필터가 완화(결함1)되면서 동시에 강화(결함2)되므로 순영향은 신호 품질 개선 방향.
- **`checkEpsAcceleration()`은 건드리지 않음** — 이미 올바른 기준으로 동작 중.

## 무효 판정

- **VALID** — 코드 검증 완료, 두 결함 모두 실제 확인됨. 수정 범위가 명확하고 기존 시스템과 간섭 없음.
