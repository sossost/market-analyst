# Plan: 레짐 분류기 안정화 (Issue #304)

## 문제 정의

5거래일(3/9~3/14) 동안 시장 레짐이 5번 변경됨.
#299에서 도입한 `CONFIRMATION_DAYS=3` + 전환 제약 맵이 실효성 부족.

### 근본 원인 분석

**Bug 1: `saveRegimePending` upsert가 확정 레코드를 덮어씀**
- `onConflictDoUpdate`에 WHERE 조건 없이 항상 `isConfirmed=false`로 리셋
- 에이전트 재실행 시(에러 복구, 수동 트리거) 이미 확정된 레코드가 pending으로 되돌려짐
- 이후 `loadConfirmedRegime()`이 null 반환 → 초기 상태 분기 → 즉시 확정

**Bug 2: 레짐 전환 후 쿨다운 기간 부재**
- 레짐이 확정되면 바로 다음 거래일부터 새 pending 누적 시작 가능
- CONFIRMATION_DAYS=3만으로는 변동성 높은 시장에서 빈번한 전환 방지 불가
- 이슈 제안: 최소 유지 기간(5거래일) 추가

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 재실행 보호 | upsert가 confirmed 레코드 덮어씀 | confirmed 레코드는 upsert 스킵 |
| 전환 쿨다운 | 없음 (3일 연속만 체크) | 확정 후 7일(달력일) 쿨다운 |
| 최악 전환 빈도 | 매 3거래일 | 최소 7달력일(~5거래일) 간격 |

## 변경 사항

### 1. `saveRegimePending` — confirmed 보호
- `onConflictDoUpdate`에 `where: eq(marketRegimes.isConfirmed, false)` 추가
- 이미 confirmed된 날짜에 재실행하면 silent no-op (에러 없음)

### 2. `applyHysteresis` — 쿨다운 기간 추가
- `MIN_HOLD_CALENDAR_DAYS = 7` 상수 추가 (~5거래일)
- 확정 레짐의 `confirmedAt`으로부터 7일 미경과 시, 다른 레짐으로의 전환 차단
- 동일 레짐 재확정은 쿨다운 미적용 (레짐 유지 강화)
- 로그에 쿨다운 상태 명시

### 3. 헬퍼 함수
- `calendarDaysBetween(from, to)` — 두 날짜 간 달력일 차이 계산

### 4. 테스트
- confirmed 레코드 upsert 보호 테스트
- 쿨다운 기간 내 전환 차단 테스트
- 쿨다운 경과 후 전환 허용 테스트
- 동일 레짐 재확정은 쿨다운 무관 테스트

## 작업 계획

1. `regimeStore.ts` 수정 (saveRegimePending, applyHysteresis, 헬퍼)
2. 기존 테스트 그린 확인
3. 신규 테스트 추가
4. 전체 테스트 스위트 통과 확인

## 리스크

- **쿨다운이 실제 급격한 시장 전환을 지연시킬 수 있음**: 7일은 합리적 타협점. BEAR 시장 진입이 최대 7일 지연되지만, 노이즈 제거 효과가 더 큼.
- **기존 DB 데이터와의 호환**: 코드 변경만으로 충분, 마이그레이션 불필요.

## 골 정렬

**ALIGNED** — 레짐 판정은 추천 진입/청산, 포지션 사이징의 기반. 5일간 5회 변경은 일관된 Phase 2 포착 불가능. 안정화는 시스템 신뢰도의 핵심.

## 무효 판정

해당 없음 — LLM 백테스트/주관적 최적화가 아닌 구조적 버그 수정.
