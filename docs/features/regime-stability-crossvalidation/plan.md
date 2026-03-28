# Plan: 레짐 판정 안정화 — VIX/공포탐욕 교차검증 + 파라미터 강화

## 문제 정의

1. **과도한 전환 빈도**: 15일간 5회 레짐 전환 — 추천 시스템에 안정적 방향성 제공 불가
2. **LATE_BULL 오판**: VIX 27.29 + 공포탐욕 21.2 상태에서 LATE_BULL(high) 판정 → 3건 즉시 손실
3. **MAX_GAP_DAYS 캘린더/거래일 혼동**: 공휴일 포함 시 확인 로직 왜곡 가능

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| BULL 판정 시 스트레스 검증 | 없음 | VIX > 25 AND 공포탐욕 < 25이면 BULL 계열 차단 |
| MIN_HOLD_CALENDAR_DAYS | 7일 | 14일 |
| CONFIRMATION_DAYS | 3일 | 5일 |
| MAX_GAP_DAYS | 4 (캘린더 고정) | 4 유지 (DB 관측 날짜 기반 — 실질적 거래일 카운팅) |

## 변경 사항

### 1. VIX/공포탐욕 교차검증 게이트 (핵심)

**파일**: `src/debate/regimeStore.ts`

- `MarketStressContext` 인터페이스 추가: `{ vix: number | null; fearGreedScore: number | null }`
- `applyHysteresis(date, stressContext?)` 시그니처 변경 — 선택적 파라미터로 하위 호환
- BULL 계열(EARLY_BULL, MID_BULL, LATE_BULL) 확정 전 스트레스 게이트:
  - VIX > 25 AND 공포탐욕 < 25 → BULL 확정 차단, 이전 레짐 유지
- 상수: `STRESS_VIX_THRESHOLD = 25`, `STRESS_FEAR_GREED_THRESHOLD = 25`

**파일**: `src/agent/run-debate-agent.ts`

- `applyHysteresis` 호출 시 MarketSnapshot에서 VIX/공포탐욕 추출하여 전달

### 2. 파라미터 강화

**파일**: `src/debate/regimeStore.ts`

- `CONFIRMATION_DAYS`: 3 → 5
- `MIN_HOLD_CALENDAR_DAYS`: 7 → 14
- 주석에 근거 명시: "15일간 5회 전환 방지 — #464"

### 3. 테스트 업데이트

**파일**: `src/debate/__tests__/regimeHysteresis.test.ts`, `__tests__/agent/debate/regimeStore.test.ts`

- 기존 테스트의 CONFIRMATION_DAYS 의존 값 업데이트 (3 → 5)
- 스트레스 교차검증 테스트 추가:
  - VIX > 25 + 공포탐욕 < 25 → BULL 차단
  - VIX > 25 + 공포탐욕 > 25 → BULL 허용 (AND 조건)
  - VIX < 25 + 공포탐욕 < 25 → BULL 허용
  - BEAR 계열은 스트레스와 무관하게 확정

## 작업 계획

1. regimeStore.ts 파라미터 변경 + 교차검증 로직 추가
2. run-debate-agent.ts 호출부 수정
3. 테스트 업데이트 + 추가
4. 빌드/테스트 확인

## 리스크

- **CONFIRMATION_DAYS 5일**: 실제 레짐 전환도 5거래일 지연. 그러나 현재 3일에서 15일간 5회 전환이 발생했으므로 안정성이 더 중요.
- **MIN_HOLD 14일**: 급변하는 시장에서 레짐 반영이 느려질 수 있으나, 잦은 전환으로 인한 추천 혼란 비용이 더 크다.
- **스트레스 데이터 누락 시**: stressContext가 null이면 게이트 미적용 (graceful degradation).

## 골 정렬

- **ALIGNED**: 잘못된 레짐 판정 → 잘못된 추천 → 손실. 레짐 안정화는 추천 품질의 기반.
