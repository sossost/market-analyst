# Plan: 펀더멘털 스코어러 turnaround 사각지대 해소

> Lite 트랙 — 이슈 #415

## 문제 정의

`fundamental-scorer.ts`에 3가지 구조적 결함으로 Phase 2 초입 종목(적자→흑자 전환)이 사각지대에 놓임:

1. **Turnaround null 처리**: `calcYoYGrowth`가 prior ≤ 0일 때 null 반환 → 흑자 전환 종목이 F등급
2. **ROE 영구 비활성**: `estimateROE`가 항상 null → 5대 기준 중 1개가 항상 0점 → A등급 도달 구조적으로 어려움
3. **가속 판정 과도한 엄격성**: 3분기 strictly monotonic 증가 요구 → 실전 유효 패턴 다수 누락

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| EPS -$1→+$0.5 | null → F등급 | turnaround 점수 +200 → required 1개 충족 |
| ROE 기준 | 항상 0점, bonusMet 최대 2 | ROE 제거, bonusMet 기준을 epsAccel+margin 2개로 운영. A등급 조건: required≥2 & bonus≥1 |
| 가속 판정 | [20,18,35] → false (18<20) | latest > avg(prior 2) → true |

## 변경 사항

### 1. Turnaround 스코어링 (`calcYoYGrowth` + `evaluateEpsGrowth`)
- `calcYoYGrowth`: prior ≤ 0이고 current > 0일 때 별도 turnaround 감지 함수 추가
- `calcTurnaroundScore(current, prior)`: prior < 0 & current > 0이면 고정 200 반환
- `evaluateEpsGrowth`: turnaround 감지 시 passed=true, value=200, detail에 "흑자 전환" 표시

### 2. ROE 제거 및 등급 매트릭스 조정
- `SEPACriteria`에서 `roe` 필드를 `roe?: CriteriaResult`로 optional화
- `scoreFundamentals`: ROE 평가 제거, bonusMet은 epsAcceleration + marginExpansion만 카운트 (최대 2)
- `determineGrade`: 기존 매트릭스 유지 (required 0-2, bonus 0-2). ROE가 빠져도 bonus 최대 2는 동일하므로 A등급 도달 가능
- `totalScore` 계산: max = 2×30 + 2×20 = 100 (변동 없음)
- **하위 호환**: `evaluateROE` 함수와 `roe` 필드는 유지하되 등급 판정에서 제외

### 3. 가속 판정 완화 (`checkEpsAcceleration`)
- 기존: 모든 인접 쌍이 strictly increasing
- 변경: latest > average(나머지). 즉 `growthRates[0] > avg(growthRates[1:])` 이면 가속
- 이유: +20%→+18%→+35%처럼 중간 소폭 감소여도 최신 분기가 강하면 유효

## 작업 계획

1. `calcTurnaroundScore` 함수 추가 + `evaluateEpsGrowth` 수정
2. `evaluateROE` → 등급 판정에서 제외 (bonusMet 카운트에서 roe 제거)
3. `checkEpsAcceleration` 로직 변경
4. 기존 테스트 업데이트 + 새 테스트 케이스 추가
5. 타입 체크 + 전체 테스트 통과 확인

## 리스크

- **Turnaround 오탐**: prior가 -$0.01이고 current가 +$0.01인 미미한 전환도 200점. 그러나 revenue growth 25% 기준이 필수이므로 required 2개 동시 충족은 실제 성장 기업만 가능.
- **가속 판정 완화 과도**: avg 비교로 변경 시 과거 대비 약간만 높아도 통과. 그러나 bonus 기준이므로 등급에 미치는 영향 제한적.

## 골 정렬

- **판정: ALIGNED**
- Phase 2 초입 종목 중 적자→흑자 전환 기업이 F등급으로 필터링되는 문제 해결 → 주도주 조기포착 정확도 직접 향상

## 무효 판정

- **해당 없음**: 정량 로직 수정, LLM 백테스트/주관 판단 무관
