# Phase 판정 정확도 강화 + Trailing Stop 도입

GitHub Issue: #287

## 선행 맥락

### tool-validation spec (이슈 #58)
- `getPhase1LateStocks.ts`의 `prev_phase` 필터 부재 문제가 발견되어, `prev_phase IS NULL OR prev_phase = 1` 조건이 추가됨
- `phase-detection.ts`의 Phase 1 vs Phase 4 판정 순서 문제는 "ETL 전체 재실행 필요"로 보류됨
- 검증 스크립트 3종이 작성되어 도구 유효성 정량 검증 완료됨

### MEMORY.md 잔존 괴리
- "phase-detection.ts: Phase 1 판정이 관대 (Phase 3→1 오판 가능). ETL 재실행 필요해서 보류 중"이 이미 기록됨
- 이번 이슈는 이 잔존 괴리가 실전 추천 성과에 직접 악영향을 미치고 있음을 확인한 것

### 추천 시스템 현황
- `saveRecommendations.ts`: BEAR 레짐 차단, 쿨다운 7일, Phase 2 지속성 태깅, 진입가 교정 — 이미 구현됨
- `update-recommendation-status.ts`: Phase 2 이탈 시 CLOSED_PHASE_EXIT — 유일한 청산 트리거
- maxPnlPercent를 매일 추적하지만, trailing stop으로 활용하는 로직은 전무

## 골 정렬

**ALIGNED** — Phase 2 초입 포착 정확도와 추천 수익률 직접 개선. 프로젝트 골("남들보다 먼저 포착하여 알파 형성")의 양 축인 '정확한 포착'과 '수익 보전'을 동시에 다룬다.

### 무효 판정 체크
- LLM 백테스트? **아님** — 코드 로직 수정 + 규칙 기반 trailing stop
- 같은 LLM이 생성+검증? **아님** — 순수 규칙 기반 로직
- 이미 실패한 접근의 반복? **아님** — phase-detection 순서 수정은 보류되었던 작업이고, trailing stop은 최초 도입

## 문제

최근 90일 추천 14건 중 5건(35%)이 Phase 2 직후 Phase 3 이탈, 승률 약 21%. 두 가지 구조적 결함이 원인이다:

1. **Phase 1 관대 판정**: phase-detection.ts에서 Phase 1이 Phase 4보다 먼저 체크되어 Phase 4 초기 종목이 Phase 1로 오분류 → 잘못된 Phase 2 전환 시그널 생성
2. **청산 타이밍 부재**: Phase 2 이탈까지 대기하면 고점 대비 큰 하락 후 청산. AAOI 사례에서 maxPnL +27.38% → 실제 PnL -5.66%로 32% 이익 증발

## Before → After

### Before (현재)

| 항목 | 상태 |
|------|------|
| `phase-detection.ts` | Phase 1 체크가 Phase 4보다 먼저 → Phase 4 초기 종목 오분류 |
| `getPhase1LateStocks.ts` | `ma150_slope > -0.001`, `rs_score >= 20`, `vol_ratio >= 1.2` — 관대 |
| 청산 로직 | Phase 2 이탈만 체크. 고점 대비 하락 보호 없음 |
| maxPnlPercent | 매일 추적하지만 활용하지 않음 |

### After (목표)

| 항목 | 목표 상태 |
|------|----------|
| `phase-detection.ts` | Phase 4 체크를 Phase 1보다 먼저 수행 + Phase 1에 MA150 기울기 전환 이력 조건 추가 |
| `getPhase1LateStocks.ts` | 임계값 상향: `vol_ratio >= 1.5`, `rs_score >= 30` |
| 청산 로직 | Trailing stop 추가: maxPnL 대비 일정% 하락 시 CLOSED_TRAILING_STOP 처리 |
| maxPnlPercent | Trailing stop 트리거로 활용 |

## 변경 사항

### 1. phase-detection.ts — Phase 4 체크 순서 변경 + Phase 1 조건 강화

**1-A: Phase 4를 Phase 1보다 먼저 체크**

현재 `determinePhase` 함수 (79~109행):
```
Phase 2 → Phase 1 → Phase 4 → Phase 3(default)
```

변경 후:
```
Phase 2 → Phase 4 → Phase 1 → Phase 3(default)
```

`determinePhase` 함수 내부에서 Phase 4 판정 블록(101~105행)을 Phase 1 판정 블록(93~98행) 위로 이동.

**1-B: Phase 1 판정에 MA150 기울기 전환 확인 추가**

현재 Phase 1 조건:
- `slopeFlat`: `Math.abs(ma150Slope) < 0.02`
- `priceNearMa150`: 가격이 MA150의 5% 이내

추가 조건 (PhaseInput 확장 필요):
- MA150 기울기가 이전에 음수였다가 현재 flat(-0.02 ~ +0.02)으로 전환된 경우만 Phase 1로 인정
- 즉, Phase 3/4에서 하락 중이다가 기울기가 안정화된 경우만 허용

**구현 방식**: PhaseInput에 `ma150SlopePrev` (20일 전의 MA150 기울기) 필드 추가. ETL에서 이미 `ma150_20dAgo`를 전달하므로, 40일 전 MA150 값도 전달하면 20일 전 기울기 계산 가능.

단, 이 변경은 ETL 파이프라인에도 영향을 미치므로 **Phase 1에서 진행하되 범위를 제한**한다:
- 1-A(순서 변경)는 단순 코드 이동이므로 즉시 적용
- 1-B(기울기 전환 조건)는 PhaseInput 확장이 필요하므로 이번 PR에서는 **Phase 4 먼저 체크만 적용**하고, 1-B는 별도 이슈로 분리

**파급 효과**: phase-detection.ts 변경 시 stock_phases 테이블의 기존 데이터와 불일치 발생. 그러나:
- 향후 ETL 실행 시 새 판정 로직이 적용됨
- 과거 데이터 재계산은 이번 PR 범위 밖 (별도 이슈)
- 기존 테스트가 있으면 업데이트 필요

### 2. getPhase1LateStocks.ts — 임계값 상향

현재 임계값 → 변경:

| 파라미터 | 현재 | 변경 | 근거 |
|---------|------|------|------|
| `ma150_slope` | `> -0.001` | 유지 | Phase 4 선행 체크로 오분류 해소 |
| `rs_score` | `>= 20` | `>= 30` | RS 20은 너무 관대. 초입 포착 도구 검증 (PR #61) 교훈 반영 |
| `vol_ratio` | `>= 1.2` | `>= 1.5` | 의미 있는 거래량 증가는 1.5배 이상 |

SQL 변경:
```sql
-- Before
AND sp.rs_score >= 20
AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.2

-- After
AND sp.rs_score >= 30
AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.5
```

### 3. update-recommendation-status.ts — Trailing Stop 도입

**새 청산 조건**: maxPnL 대비 현재 PnL이 일정 비율 이상 하락하면 자동 청산.

```typescript
// 상수 정의
const TRAILING_STOP_THRESHOLD = 0.5; // maxPnL의 50% 이상 되돌림 시 청산
const MIN_MAX_PNL_FOR_TRAILING = 10; // maxPnL이 10% 이상일 때만 trailing stop 활성화
```

**로직**:
```typescript
// 기존: Phase 이탈만 체크
const isPhaseExit = currentPhase != null && currentPhase !== 2;

// 추가: Trailing stop 체크
const isTrailingStop =
  maxPnlPercent >= MIN_MAX_PNL_FOR_TRAILING &&
  pnlPercent < maxPnlPercent * (1 - TRAILING_STOP_THRESHOLD);
```

- `maxPnL >= 10%`이고, 현재 PnL이 maxPnL의 50% 미만으로 하락하면 발동
- 예시: maxPnL 27% → trailing stop 발동 시 PnL < 13.5% (27 * 0.5)
- AAOI 사례 적용: maxPnL 27.38% → PnL 13.69% 미만에서 청산 → 실제 -5.66%보다 훨씬 나은 결과

**상태 값**: `CLOSED_TRAILING_STOP` 추가

```typescript
...(isTrailingStop && !isPhaseExit
  ? {
      status: "CLOSED_TRAILING_STOP",
      closeDate: targetDate,
      closePrice: String(currentPrice),
      closeReason: `Trailing stop: maxPnL ${maxPnlPercent.toFixed(1)}% → 현재 ${pnlPercent.toFixed(1)}% (${TRAILING_STOP_THRESHOLD * 100}% 되돌림 초과)`,
    }
  : {}),
```

**우선순위**: Phase 이탈이 trailing stop보다 우선. 둘 다 해당되면 Phase 이탈로 처리.

### 4. readRecommendationPerformance.ts — trailing stop 메트릭 추가

성과 조회 시 trailing stop으로 청산된 건을 구분할 수 있도록 closeReason 기반 통계 추가.

### 5. (이번 PR 제외 — 별도 이슈) 교차 검증 필터 코드화

이슈에서 제안한 `getPhase1LateStocks ∩ getRisingRS ∩ getFundamentalAcceleration` 교집합 필터는 에이전트 도구 아키텍처의 근본적 변경이 필요하므로 별도 이슈로 분리한다. 현재는 시스템 프롬프트에서 교집합 사용을 가이드하는 수준으로 유지.

## 스코프 결정

이슈에서 제안한 6개 항목 중 이번 PR 포함 범위:

| # | 항목 | 포함 여부 | 사유 |
|---|------|----------|------|
| 1 | phase-detection.ts Phase 4 먼저 체크 | **포함** | 단순 코드 이동, 파급 최소 |
| 2 | Phase 1 판정 MA150 기울기 전환 이력 | **제외** | PhaseInput 확장 + ETL 수정 필요. 별도 이슈 |
| 3 | getPhase1LateStocks 임계값 상향 | **포함** | SQL 수정만, 즉시 적용 가능 |
| 4 | Trailing stop 도입 | **포함** | 핵심 가치. maxPnl 인프라 이미 존재 |
| 5 | BEAR 레짐 신규 추천 억제 | **이미 구현** | saveRecommendations.ts에 BEAR_REGIMES gate 존재 |
| 6 | 교차 검증 필터 코드화 | **제외** | 도구 아키텍처 변경 필요. 별도 이슈 |

## 작업 계획

### Phase 1: Phase 판정 정확도 (선행)

| # | 작업 | 에이전트 | 완료 기준 |
|---|------|---------|----------|
| 1-1 | `phase-detection.ts` — Phase 4 체크를 Phase 1보다 먼저 이동 | 실행팀 | determinePhase 함수에서 Phase 4 블록이 Phase 1 위에 위치. 기존 테스트 통과 + 새 테스트 추가 |
| 1-2 | `phase-detection.ts` 테스트 업데이트 | 실행팀 | Phase 4 조건 충족 + Phase 1 조건도 충족하는 입력이 Phase 4로 판정되는 테스트 케이스 추가 |
| 1-3 | `getPhase1LateStocks.ts` 임계값 상향 (`rs_score >= 30`, `vol_ratio >= 1.5`) | 실행팀 | SQL 수정, 기존 테스트 업데이트 |

**병렬**: 1-1/1-2 와 1-3 병렬 가능

### Phase 2: Trailing Stop 도입

| # | 작업 | 에이전트 | 완료 기준 |
|---|------|---------|----------|
| 2-1 | `update-recommendation-status.ts` — trailing stop 로직 추가 | 실행팀 | TRAILING_STOP_THRESHOLD(50%), MIN_MAX_PNL_FOR_TRAILING(10%) 상수 정의. Phase 이탈보다 후순위 체크. CLOSED_TRAILING_STOP 상태로 기록 |
| 2-2 | trailing stop 단위 테스트 | 실행팀 | 시나리오: (a) maxPnl 미달 → 미발동, (b) maxPnl 충족 + 되돌림 초과 → 발동, (c) Phase 이탈과 동시 → Phase 이탈 우선, (d) 음수 PnL(손실 상태) → 미발동 |
| 2-3 | `readRecommendationPerformance.ts` — CLOSED_TRAILING_STOP 통계 구분 | 실행팀 | closeReason에 trailing stop 포함 건 카운트 |

**병렬**: Phase 1과 Phase 2 전체 병렬 가능 (독립적)

### Phase 3: 검증 + 리뷰

| # | 작업 | 에이전트 | 완료 기준 |
|---|------|---------|----------|
| 3-1 | 기존 테스트 전체 실행 (`vitest run`) | 실행팀 | 모든 테스트 통과 |
| 3-2 | 코드 리뷰 | code-reviewer | CRITICAL/HIGH 이슈 없음 |
| 3-3 | PR 생성 | pr-manager | #287 연결 |

**순서**: 3-1 → 3-2 → 3-3

## 테스트 계획

### phase-detection.ts

```typescript
// 새 테스트: Phase 4 조건과 Phase 1 조건이 동시에 충족될 때 Phase 4로 판정
it('classifies as Phase 4 when both Phase 1 and Phase 4 conditions overlap', () => {
  // MA150 slope가 flat(-0.02 이내)이면서 가격이 MA150 근처이고,
  // 동시에 price < MA150, MA150 < MA200, slope < 0, RS < 50인 경우
  const input: PhaseInput = {
    price: 98,     // MA150 근처 (flat 조건 충족)
    ma50: 95,
    ma150: 100,    // price < MA150 (Phase 4 조건)
    ma200: 105,    // MA150 < MA200 (Phase 4 조건)
    ma150_20dAgo: 101.5, // slope = (100 - 101.5) / 101.5 = -0.0148 (flat 범위이면서 음수)
    rsScore: 35,   // RS < 50 (Phase 4 조건), RS >= 20 (Phase 1 도구 범위)
    high52w: 150,
    low52w: 80,
  };
  const result = detectPhase(input);
  expect(result.phase).toBe(4); // Phase 1이 아닌 Phase 4
});
```

### trailing stop

```typescript
describe('trailing stop', () => {
  it('does not trigger when maxPnl < MIN_MAX_PNL_FOR_TRAILING', () => {
    // maxPnl: 8%, currentPnl: 2% → 되돌림 75%이지만 maxPnl 미달로 미발동
  });

  it('triggers when maxPnl >= threshold and retracement exceeds limit', () => {
    // maxPnl: 25%, currentPnl: 10% → 되돌림 60% > 50% → 발동
  });

  it('does not trigger when retracement is within limit', () => {
    // maxPnl: 20%, currentPnl: 15% → 되돌림 25% < 50% → 미발동
  });

  it('Phase exit takes priority over trailing stop', () => {
    // Phase 3 이탈 + trailing stop 동시 충족 → CLOSED_PHASE_EXIT
  });

  it('does not trigger on negative PnL', () => {
    // maxPnl: 15%, currentPnl: -3% → trailing stop 미발동 (이미 손실 상태)
    // Phase 이탈로 처리되어야 함
  });
});
```

## Trailing Stop 파라미터 근거

| 파라미터 | 값 | 근거 |
|---------|-----|------|
| `TRAILING_STOP_THRESHOLD` | 50% | Weinstein 방법론: Phase 2 주도주는 30~50% 상승 후 10~20% 조정이 정상. 50% 되돌림은 "정상 조정을 넘어 추세 약화" 시그널 |
| `MIN_MAX_PNL_FOR_TRAILING` | 10% | 10% 미만 이익에서 trailing stop을 걸면 정상 변동성에 의한 조기 청산 위험. 10%는 의미 있는 이익이 형성된 시점 |

AAOI 사례 검증:
- maxPnL: +27.38%
- Trailing stop 발동 조건: PnL < 27.38% * 0.5 = 13.69%
- 실제 청산 PnL: -5.66%
- Trailing stop 적용 시: +13.69% 근처에서 청산 → 약 19% 수익 보전

## 리스크

1. **phase-detection.ts 순서 변경의 파급**: Phase 4가 먼저 체크되면 기존에 Phase 1로 분류되던 종목 중 일부가 Phase 4로 변경됨. 이는 의도된 동작이지만, stock_phases 테이블의 과거 데이터와 불일치 발생. 향후 ETL 실행 시 자연스럽게 수렴.

2. **Trailing stop 파라미터 최적화**: 50%/10% 초기 설정은 보수적 추정. 실전 운영 데이터가 쌓이면 파라미터 조정이 필요할 수 있음. signal_params 테이블에 기록하여 변경 이력 추적 권장.

3. **getPhase1LateStocks 임계값 상향으로 시그널 감소**: rs_score 20→30, vol_ratio 1.2→1.5로 상향하면 시그널 수가 줄어들 수 있음. 그러나 false positive 감소가 더 중요하다고 판단.

4. **CLOSED_TRAILING_STOP 상태 추가**: 기존 코드에서 status를 문자열로 관리하고 있어 (enum이 아님) 호환성 문제는 없으나, 프론트엔드 대시보드에 새 상태 표시가 필요할 수 있음.

## 의사결정 (자율 판단)

| 항목 | 판단 | 근거 |
|------|------|------|
| Phase 1-B(MA150 기울기 전환) 포함 여부 | **이번 PR에서 제외** | PhaseInput 확장 + ETL 수정 필요. 1-A(순서 변경)만으로도 핵심 문제 해소 가능. 별도 이슈로 분리 |
| Trailing stop 파라미터 | 50% 되돌림 / 10% 최소 maxPnL | Weinstein 방법론 기준 + AAOI 사례 역검증. 보수적 시작 후 데이터 기반 조정 |
| 교차 검증 필터 코드화 | **별도 이슈** | 에이전트 도구 아키텍처 근본 변경 필요. 프롬프트 가이드로 충분히 작동 중 |
| 과거 stock_phases 재계산 | **하지 않음** | ETL 일상 실행으로 자연 수렴. 과거 데이터 일관성보다 향후 정확도 우선 |
