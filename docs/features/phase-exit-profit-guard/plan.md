# Phase Exit 수익 구간 보호 (Profit Guard)

GitHub Issue: #518

## 골 정렬

**ALIGNED** — Phase 2 초입 포착 후 수익 실현이 알파 형성의 핵심. 진입 정확도 개선과 별개로 청산 메커니즘이 수익을 갉아먹으면 시스템 전체 가치가 훼손된다.

### 무효 판정 체크
- LLM 백테스트? **아님** — 순수 규칙 기반 로직 수정
- 같은 LLM이 생성+검증? **아님** — 코드 로직 변경
- 이미 실패한 접근의 반복? **아님** — Phase Exit + Trailing Stop 우선순위 조정은 최초 시도

## 문제

Phase Exit가 PnL 상태와 무관하게 발동하여, 수익 구간(PnL > 0)에서도 phase 변경 시 즉시 청산한다.
Trailing stop이 수익을 보호하기 전에 Phase Exit가 먼저 포지션을 닫는 구조적 레이스 컨디션.

**데이터 근거 (90일):**
- CLOSED_PHASE_EXIT 6건: avg maxPnL +4.6% → avg realized PnL **-15.0%**
- AAOI: maxPnL +27.4% → realized -5.7% (Phase 3 이탈)

## Before → After

### Before (현재)

| 항목 | 상태 |
|------|------|
| Phase Exit 조건 | `currentPhase != null && currentPhase !== 2` — PnL 무관 |
| 수익 구간 보호 | trailing stop tier(2%+)에만 의존. PnL > 0이어도 phase 변경 시 즉시 청산 |
| 우선순위 | stop-loss > trailing stop > phase exit (PnL 조건 없음) |

### After (목표)

| 항목 | 목표 상태 |
|------|----------|
| Phase Exit 조건 | `currentPhase != null && currentPhase !== 2 && pnlPercent <= 0` |
| 수익 구간 보호 | PnL > 0이면 phase exit 미발동. trailing stop이 수익 보호 전담 |
| 우선순위 | stop-loss > trailing stop > phase exit(손실 구간 한정) |

## 변경 사항

### 1. `shouldTriggerPhaseExit` 순수 함수 추가

`src/etl/jobs/update-recommendation-status.ts`에 새 순수 함수 추가:

```typescript
export function shouldTriggerPhaseExit(params: {
  currentPhase: number | null;
  pnlPercent: number;
}): boolean {
  if (params.currentPhase == null) return false;
  if (params.currentPhase === 2) return false;
  return params.pnlPercent <= 0;
}
```

### 2. main() 함수 내 phase exit 판정 변경

```typescript
// Before:
const isPhaseExit = currentPhase != null && currentPhase !== 2;

// After:
const isPhaseExit = shouldTriggerPhaseExit({ currentPhase, pnlPercent });
```

### 3. 테스트 추가

`shouldTriggerPhaseExit` 순수 함수 테스트 + 우선순위 통합 테스트:
- PnL > 0 + Phase 3 → 미발동
- PnL = 0 + Phase 3 → 발동
- PnL < 0 + Phase 3 → 발동
- Phase 2 유지 → 미발동
- currentPhase null → 미발동
- 수익 구간에서 trailing stop + phase exit 동시 조건 → trailing stop만 발동

## 작업 계획

| # | 작업 | 완료 기준 |
|---|------|----------|
| 1 | `shouldTriggerPhaseExit` 순수 함수 추가 | export, 기존 inline 조건 대체 |
| 2 | main() 내 `isPhaseExit` 판정을 함수 호출로 변경 | 기존 동작 대비 PnL > 0 구간만 차이 |
| 3 | 테스트 작성 (순수 함수 + 우선순위) | 전체 테스트 통과, 커버리지 80%+ |

## 리스크

1. **PnL > 0 구간에서 포지션 유지 연장**: Phase 2 이탈 후에도 PnL > 0이면 포지션이 유지된다. trailing stop tier(2%+)가 커버하지 않는 maxPnl 0~2% 구간은 PnL이 0 이하로 떨어져야 phase exit 발동. 이 구간의 수익 규모가 작아(< 2%) 실질적 리스크 미미.

2. **기존 CLOSED_PHASE_EXIT 빈도 감소**: 수익 구간 phase exit가 suppressed되므로 CLOSED_PHASE_EXIT 이벤트 수 감소. 대신 CLOSED_TRAILING_STOP 증가 또는 포지션 유지 시간 증가 예상. 성과 리포트 해석 시 고려 필요.
