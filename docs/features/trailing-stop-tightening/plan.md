# Plan: Trailing Stop 되돌림 임계값 타이트닝

> Lite 트랙 — 단순 파라미터 조정 + 테스트 갱신

## 문제 정의

Trailing stop의 중간 구간(5-10%) 되돌림이 40%로 관대하여, 수익이 있던 종목이 큰 폭의 되돌림을 허용함.
DWSN 사례: max +10.86% → -33.03% (당시 50% 단일 임계값 시절 발생, 이후 #413에서 4단계 tier 도입).

현재 tier 구조가 이미 존재하나, 5-10% 구간의 retracement(40%)와 profitFloor(0%)가 여전히 개선 여지 있음.

## Before → After

| Tier (minMaxPnl) | Before retracement | After retracement | Before profitFloor | After profitFloor |
|---|---|---|---|---|
| 20% | 0.25 | 0.25 (유지) | 10 | 10 (유지) |
| 10% | 0.30 | **0.25** | 3 | **5** |
| 5% | 0.40 | **0.30** | 0 | **1** |
| 2% | 0.50 | 0.50 (유지) | 0 | 0 (유지) |

### 시뮬레이션 (변경 후)

| 사례 | maxPnl | Before trailing level | After trailing level | 개선 |
|---|---|---|---|---|
| DWSN | 10.86% | 7.60% (30% 되돌림) | **8.15%** (25% 되돌림, floor 5) | +0.55%p 높은 보호 |
| 7% 도달 종목 | 7% | 4.20% (40% 되돌림) | **4.90%** (30% 되돌림, floor 1) | +0.70%p 높은 보호 |
| 5% 경계 종목 | 5% | 3.00% (40% 되돌림) | **3.50%** (30% 되돌림, floor 1) | +0.50%p + 최소 1% 보장 |

## 변경 사항

1. **`src/etl/jobs/update-recommendation-status.ts`**: PROFIT_TIERS 상수 업데이트
   - 10% tier: retracement 0.30 → 0.25, profitFloor 3 → 5
   - 5% tier: retracement 0.40 → 0.30, profitFloor 0 → 1
2. **`src/etl/jobs/__tests__/update-recommendation-status.test.ts`**: 순수 함수 테스트 갱신
3. **`__tests__/etl/update-recommendation-status.test.ts`**: 통합 테스트 갱신

## 스코프 외

- 시간 기반 trailing (보유 5일+ 타이트닝): 복잡도 대비 효과 불명확. 데이터 축적 후 별도 이슈로 검토.
- 20% tier 및 2% tier: 이미 적절한 수준. 변경 불필요.

## 리스크

- **조기 청산 증가 가능**: 5-10% 구간의 타이트닝으로 정상 변동성에서 조기 청산될 수 있음.
  → 완화: 30%/25% 수준은 일간 변동성(2-3%)에 비해 여전히 충분한 여유. 운영 모니터링으로 추적.
- **갭 다운 리스크는 미해결**: 일간 ETL 기반이므로 장중 갭 다운은 원천 방어 불가.
  → 이는 아키텍처 한계이며 이번 이슈의 범위 밖.

## 골 정렬

- **판정: SUPPORT** — Phase 2 주도주 초입 포착의 성과를 보존하는 퇴출 타이밍 개선. 포착 품질과 직접 관련은 아니나, 포착된 종목의 수익을 지키는 보완 역할.

## 무효 판정

- **해당 없음** — LLM 백테스트 등 무효 패턴에 해당하지 않음. 순수 파라미터 조정.

## 작업 계획

1. PROFIT_TIERS 상수 수정
2. 순수 함수 테스트 갱신 (findProfitTier, shouldTriggerTrailingStop, formatTrailingStopReason)
3. 통합 테스트 갱신
4. 전체 테스트 통과 확인
