# Plan: 청산 메커니즘 개선 — 소수익 구간 보호 (Lite 트랙)

## 문제 정의

이슈 #413이 지적하는 4개 종목(AAOI, DWSN, BATL, AG)의 수익→손실 전환 사례 중,
AAOI/DWSN은 이미 #359에서 구현된 **단계적 trailing stop**(tiered profit tiers)으로 해결됨.

**남은 구조적 갭**: maxPnl이 0~5% 구간인 포지션에 trailing stop이 없음.
- 현재: maxPnl < 5%이면 trailing stop 미발동 → phase exit(-7% hard stop까지 방치)
- BATL(0%→-16.7%), AG(0%→-21.26%) 같은 케이스는 hard stop-loss(-7%)로 손실 제한되지만,
  maxPnl 2~4.9% 구간의 소수익 포지션이 phase exit 시 손실로 전환되는 문제 잔존.

## 골 정렬

- **판정: ALIGNED**
- "Phase 2 주도섹터/주도주 초입 포착" 목표에서 포착 후 수익 보호 실패는 알파 형성의 직접적 병목.
  소수익 구간까지 보호하면 양수 PnL 종료 비율 개선 → 시스템 신뢰도 향상.

## 무효 판정

- **LLM 백테스트 해당 여부: 해당 없음**
- 순수 로직 변경(상수 추가 + 조건문). 백테스트/시뮬레이션 불필요.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Trailing stop 최소 진입 | maxPnl ≥ 5% | maxPnl ≥ 2% |
| maxPnl 3% → phase exit 시 | PnL 위치 무관 청산 (최악 -7%) | PnL < 1.5%이면 trailing stop 발동 |
| Phase exit closeReason | `Phase 3 이탈 (RS 98)` | `Phase 3 이탈 (RS 98, maxPnL 4.2%)` — 수익 반납 추적 가능 |
| Tier 수 | 3개 (20%, 10%, 5%) | 4개 (20%, 10%, 5%, 2%) |

## 변경 사항

### 1. 새 trailing stop tier 추가
- **파일**: `src/etl/jobs/update-recommendation-status.ts`
- `PROFIT_TIERS` 배열에 `{ minMaxPnl: 2, retracement: 0.50, profitFloor: 0 }` 추가
- 의미: maxPnl 2%+ 도달 시, 고점 대비 50% 되돌림에서 청산. 최소 보장 수익 0% (손실 전환 방지).

### 2. Phase exit closeReason에 maxPnl 포함
- **파일**: `src/etl/jobs/update-recommendation-status.ts`
- Phase exit 시 closeReason에 maxPnlPercent 추가하여 수익 반납 규모 추적 가능

### 3. 테스트 업데이트
- **파일**: `src/etl/jobs/__tests__/update-recommendation-status.test.ts`
- 새 tier(2%+) 관련 테스트 케이스 추가
- Phase exit closeReason 포맷 테스트 (해당 시)

## 작업 계획

1. PROFIT_TIERS에 2% tier 추가
2. Phase exit closeReason 포맷 개선
3. 테스트 추가 및 기존 테스트 업데이트
4. 전체 테스트 통과 확인

## 리스크

- **False positive 위험**: 2% tier는 변동성 높은 종목에서 조기 청산 유발 가능.
  다만 50% 되돌림이므로 maxPnl 4%이면 2%까지 허용 — 일상적 변동 범위 내에서는 미발동.
- **기존 동작 변경 없음**: 5%+ 구간의 기존 tier는 그대로 유지.
