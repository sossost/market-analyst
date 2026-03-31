# Plan: 레짐 최소 체류 기간 (Dwell Time) — Confidence-Scaled Confirmation

## 문제 정의

3/12~3/27 기간 LLM 레짐 판정이 EARLY_BULL↔EARLY_BEAR 사이 6회 진동 (평균 체류 2.5일).
전환기 신뢰도가 전부 medium — 확신 없는 상태에서 레짐이 반복 전환.

현재 hysteresis가 confidence를 저장하지만 **confirmation 판정에 반영하지 않음**.
high든 medium이든 동일하게 5일 연속이면 확정. medium-confidence 노이즈가 방어되지 않는 구조적 결함.

## 골 정렬

**ALIGNED** — 레짐 안정성은 추천 게이트(Bear Gate, Late Bull Gate)의 일관성에 직결.
게이트 진동은 Phase 2 포착 정확도를 저하시키고, 시스템 전체 신뢰도를 훼손.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 확정 필요 일수 | 5일 (신뢰도 무관) | high: 5일, medium/low: 7일 |
| medium 진동 방어 | 없음 (5일이면 확정) | 7일 연속 필요 → 노이즈 필터링 강화 |
| 기존 동작 호환 | — | high confidence 경로 완전 동일 |

## 변경 사항

### `src/debate/regimeStore.ts`

1. **`CONFIRMATION_DAYS` → confidence별 분기**
   - `CONFIRMATION_DAYS_HIGH = 5` (기존 동일)
   - `CONFIRMATION_DAYS_MEDIUM = 7` (medium/low 전환에 2일 추가 요구)
   - `MAX_CONFIRMATION_DAYS = 7` (윈도우 사이징용)

2. **`applyHysteresis` 수정**
   - pending 조회 limit을 `MAX_CONFIRMATION_DAYS`(7)로 확대
   - pending window 계산을 `MAX_CONFIRMATION_DAYS` 기준으로 확대
   - pending rows의 최소 confidence로 required days 결정
   - `hasEnoughPending` 기준을 confidence-scaled days로 변경

3. **`formatRegimeForPrompt` 수정**
   - pending 확정 잔여일 계산에 confidence-scaled days 반영

### `src/debate/__tests__/regimeHysteresis.test.ts`

신규 테스트 케이스:
- medium confidence 5일 연속 → 확정 안 됨 (7일 필요)
- medium confidence 7일 연속 → 확정됨
- high confidence 5일 연속 → 확정됨 (기존 동작 유지)
- 혼합 confidence (high+medium) → 7일 필요
- 이슈 시나리오 재현: 2.5일 주기 진동 → 확정 안 됨

## 작업 계획

1. regimeStore.ts 수정 (confidence-scaled confirmation)
2. 테스트 작성 및 통과 확인
3. 코드 리뷰 + 커밋

## 리스크

- **이중 지연**: cooldown(14일) + confidence-scaled confirmation(7일) = 최대 21일 지연. 진짜 Bear 진입 시 대응 지연 가능. 단, high confidence 전환은 5일로 유지되므로 급격한 시장 변화(high confidence로 판정됨)에는 기존과 동일 속도.
- **#517 간섭**: LATE_BULL 감쇠 게이트는 confirmed regime만 참조하므로, confirmation 기준 변경이 게이트 발동 타이밍에 영향. 그러나 LATE_BULL→EARLY_BEAR 전환이 medium이면 2일 더 유지되는 것은 오히려 감쇠 게이트 안정성에 긍정적.

## 무효 판정

**해당 없음** — regime confidence는 이미 DB에 저장되는 필드이며, confirmation 로직에서 활용하는 것은 자연스러운 확장.
