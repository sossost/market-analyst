# Breadth Score v2

## 선행 맥락

- `memory/project_backfill_pending.md`: market_breadth_daily 2025-01-01 확장 백필이 진행 중. 단계 2(build-market-breadth 백필)가 단계 1(daily_ma 백필) 완료 후 대기 중. v2 전환 이후 백필을 재실행하면 과거 행도 v2 점수로 일괄 교체됨. 백필 재실행은 v2 구현 완료 후 별도 이슈로 진행.
- 기존 `computeBreadthScore()` 함수의 변동성 분석: A/D 비율(0.20)과 H/L 비율(0.15)이 일일 스냅샷 값이라 퍼센타일 범위가 각각 64pt 수준. 이 두 지표가 일간 변동의 90%를 지배. 대조적으로 Phase2 비율(0.35)은 퍼센타일 범위 3.6pt로 매우 안정적.
- CEO가 설계를 승인한 상태. 기획서는 승인된 설계를 구현 범위로 확정하는 문서임.

## 골 정렬

ALIGNED — Phase 2 초입 포착이 프로젝트의 핵심 골이며, 이 기획은 그 신호를 담는 BreadthScore를 직접 개선한다. 현재 ±11pt 일간 변동은 시그널로서 사용 불가 수준. 5일 누적 스케일로 전환하면 노이즈가 제거되고, Phase 순유입(1→2 진입 - 2→3 이탈) 컴포넌트가 Phase 2 초입 포착에 직접 기여한다.

## 문제

BreadthScore의 일평균 변동이 ±11.19pt(최대 45pt, 47%의 날이 10pt 이상 스윙)에 달해 유의미한 시장 건강도 시그널로 사용할 수 없는 상태다. 근본 원인은 A/D 비율과 H/L 비율이 일일 스냅샷 지표임에도 252일 퍼센타일 랭킹에 투입되어 일일 노이즈를 그대로 증폭시키는 데 있다.

## Before → After

**Before**
- 5개 컴포넌트: Phase2 비율(0.35) + Fear & Greed(0.20) + A/D 비율(0.20) + H/L 비율(0.15) + Market Avg RS(0.10)
- A/D, H/L은 일일 스냅샷 값 → 퍼센타일 64pt 범위
- CNN F&G는 외부 API 의존 + 블랙박스
- 일간 변동 ±11.19pt, 최대 45pt

**After**
- 5개 컴포넌트: Phase2 비율(0.30) + Phase2 모멘텀(0.20) + Phase 순유입(0.20) + A/D 5일 누적(0.15) + VIX 역퍼센타일(0.15)
- 모든 입력의 시간 스케일이 최소 5일로 통일
- 외부 API 의존 없음 (VIX는 index_prices에서 조회)
- 일간 변동 대폭 축소 (설계 목표: 5pt 이하)

## 변경 사항

### 핵심 변경

**1. `computeBreadthScoreV2()` 함수 신설 (기존 `computeBreadthScore()` 교체)**

새 함수 시그니처:
```typescript
interface BreadthScoreV2Input {
  phase2Ratio:        number;        // 오늘 Phase2 비율
  phase2Ratio5dAgo:   number | null; // 5거래일 전 Phase2 비율
  netPhaseFlow5d:     number | null; // 5일 누적 (1→2 진입 - 2→3 이탈)
  adNet5d:            number | null; // 5일 누적 (advancers - decliners)
  vixClose:           number | null; // 오늘 VIX 종가
}

interface Window252DataV2 {
  phase2Ratios:        (number | null)[]; // 기존 유지
  phase2Momentum5d:    (number | null)[]; // (오늘 P2비율 - 5일전 P2비율) 시계열
  netPhaseFlow5d:      (number | null)[]; // 5일 누적 순유입 시계열
  adNet5d:             (number | null)[]; // 5일 누적 A/D 순 시계열
  vixClosePrices:      (number | null)[]; // VIX 종가 시계열
  breadthScores:       (number | null)[]; // 기존 유지 (divergence 계산용)
}
```

컴포넌트 계산 로직:
- **Phase2 비율 (0.30)**: `computePercentileRank(phase2Ratio, window.phase2Ratios)`
- **Phase2 모멘텀 (0.20)**: 오늘 P2비율 - 5일전 P2비율 = momentum. `computePercentileRank(momentum, window.phase2Momentum5d)`. `phase2Ratio5dAgo == null`이면 50으로 대체.
- **Phase 순유입 (0.20)**: `computePercentileRank(netPhaseFlow5d, window.netPhaseFlow5d)`. `netPhaseFlow5d == null`이면 50으로 대체.
- **A/D 5일 누적 (0.15)**: `computePercentileRank(adNet5d, window.adNet5d)`. `adNet5d == null`이면 50으로 대체.
- **VIX 역퍼센타일 (0.15)**: `100 - computePercentileRank(vixClose, window.vixClosePrices)`. `vixClose == null`이면 나머지 4개 가중치를 합 1.0이 되도록 재정규화.

재정규화 공식 (VIX null 시):
```
phase2Ratio:0.30 → 0.3529
phase2Momentum:0.20 → 0.2353
netPhaseFlow:0.20 → 0.2353
adNet5d:0.15 → 0.1765
합계 = 1.0
```

**2. `fetchWindow252()` → `fetchWindow252V2()` 신설**

기존 함수를 수정하지 않고 새 함수를 만든다 (divergence 계산용 `breadthScores` 필드는 공통으로 필요).

추가 조회 컬럼:
```sql
SELECT
  phase2_ratio,
  phase1_to2_count_1d,
  phase2_to3_count_1d,
  advancers,
  decliners,
  vix_close,
  breadth_score
FROM market_breadth_daily
WHERE date < $1
ORDER BY date DESC
LIMIT 252
```

클라이언트 측 파생 계산 (배열 map):
- `phase2Momentum5d`: `phase2Ratios[i] - phase2Ratios[i+4]` (DESC 정렬이므로 i+4가 5일 전). 배열 크기 5 미만이면 null.
- `netPhaseFlow5d`: 최근 5행의 `(phase1_to2_count_1d - phase2_to3_count_1d)` 합산. null 행은 0으로 처리.
- `adNet5d`: 최근 5행의 `(advancers - decliners)` 합산. null 행은 0으로 처리.
- `vixClosePrices`: vix_close 직접 매핑.

**3. `buildMarketBreadth()` 함수 내부 수정**

- 오늘의 `phase2Ratio5dAgo` 계산: `market_breadth_daily`에서 `WHERE date < targetDate ORDER BY date DESC LIMIT 5`로 5행 조회. 5번째 행의 `phase2_ratio`. 5행 미만이면 null.
- 오늘의 `netPhaseFlow5d` 계산: 최근 5거래일의 `phase1_to2_count_1d - phase2_to3_count_1d` 합산. null은 0으로 처리.
- 오늘의 `adNet5d` 계산: 최근 5거래일의 `advancers - decliners` 합산. null은 0으로 처리.
  - 주의: 오늘 당일 값은 아직 DB에 없으므로, 직전 4일은 `market_breadth_daily`에서 조회하고 오늘 당일 값은 이미 계산된 `adData`를 사용.
- `computeBreadthScoreV2()` 호출로 교체.
- `fetchWindow252V2()` 호출로 교체.

**4. 백필 스크립트 수정**

`scripts/backfill-market-breadth.ts`: 기존 로직 그대로 유지. `buildMarketBreadth()` 내부가 v2로 바뀌므로 별도 수정 불필요. 단, `--from` 파라미터 사용 가이드를 주석으로 추가.

### 제거하는 것

- `computeBreadthScore()` 함수: 테스트 파일에서 참조 중. 삭제하지 않고 `@deprecated` JSDoc 추가.
- `Window252Data` 인터페이스: 동일하게 deprecated 처리.
- `BreadthScoreInput` 인터페이스: 동일하게 deprecated 처리.
- H/L 비율은 점수 계산에서 제외. DB 컬럼(`hl_ratio`, `new_highs`, `new_lows`) 및 stat-chip 표시는 유지.
- Fear & Greed는 점수 계산에서 제외. DB 컬럼(`fear_greed_score`, `fear_greed_rating`) 및 CNN API 조회는 유지(DB에 기록만 계속).
- Market Avg RS는 점수 계산에서 제외. DB 컬럼(`market_avg_rs`) 및 조회는 유지.

### 수정 불필요한 것

- `computePercentileRank()`: 로직 동일, 재사용.
- `computeDivergenceSignal()`: breadthScore 기반 로직 동일, 재사용.
- `fetchSpx5dChange()`: 변경 없음.
- `getMarketBreadth.ts`: `breadth_score` 컬럼 값을 그대로 읽으므로 수정 불필요.
- `daily-html-builder.ts`, `weekly-html-builder.ts`: `breadthScore` 필드명 동일하므로 수정 불필요.
- `marketDataLoader.ts`: 동일.
- `run-daily-agent.ts`, `run-weekly-agent.ts`: 동일.
- DB 스키마(`analyst.ts`): 컬럼 추가/삭제 없음. `breadth_score` 컬럼을 v2 값으로 덮어씀.

## 작업 계획

### 단계 1: 핵심 로직 구현 (구현 에이전트)

**완료 기준**: `build-market-breadth.ts`에 `BreadthScoreV2Input`, `Window252DataV2` 인터페이스와 `computeBreadthScoreV2()`, `fetchWindow252V2()` 함수가 추가되고, `buildMarketBreadth()` 내부가 v2 입력을 계산하여 v2 함수를 호출한다.

구현 순서:
1. `Window252DataV2` 인터페이스 추가
2. `BreadthScoreV2Input` 인터페이스 추가
3. `fetchWindow252V2()` 구현 (SQL 조회 + 클라이언트 측 파생 계산)
4. `computeBreadthScoreV2()` 구현 (가중합 + VIX null 재정규화)
5. `buildMarketBreadth()` 내부에서 v2 입력 계산 로직 추가:
   - `fetchPrev5DaysBreadthData()` 헬퍼 함수: 직전 4거래일의 `phase2_ratio`, `phase1_to2_count_1d`, `phase2_to3_count_1d`, `advancers`, `decliners` 조회 (오늘 당일 제외)
   - `netPhaseFlow5d` = 직전4일 합산 + 오늘 당일 (p1to2Count1dData - p2to3Count1dData)
   - `adNet5d` = 직전4일 합산 + 오늘 당일 (adData.advancers - adData.decliners)
   - `phase2Ratio5dAgo` = 직전 5거래일 중 가장 오래된 날의 phase2_ratio
6. 기존 `computeBreadthScore()` 호출을 `computeBreadthScoreV2()` 호출로 교체
7. 기존 `fetchWindow252()` 호출을 `fetchWindow252V2()` 호출로 교체
8. 기존 인터페이스/함수에 `@deprecated` JSDoc 추가

### 단계 2: 테스트 작성 (TDD 에이전트)

**완료 기준**: `src/etl/jobs/__tests__/build-market-breadth.test.ts`에 v2 관련 테스트가 추가되고 `yarn vitest run` 통과.

테스트 대상:
- `computeBreadthScoreV2()`:
  - VIX null 시 재정규화 동작 (가중치 합이 1.0이 되는지)
  - VIX 있을 때 정상 계산 (숫자 검증)
  - phase2Ratio5dAgo null 시 모멘텀 컴포넌트 50으로 대체
  - netPhaseFlow5d null 시 50으로 대체
  - adNet5d null 시 50으로 대체
  - 결과 0~100 클램핑
  - 소수점 2자리 반올림
- `computePercentileRank()`: 기존 테스트 유지 (변경 없음)
- `computeDivergenceSignal()`: 기존 테스트 유지 (변경 없음)

### 단계 3: 로컬 검증 (구현 에이전트)

**완료 기준**: 최근 거래일 1건에 대해 `buildMarketBreadth(date)` 직접 실행 후 DB에 새 `breadth_score` 값이 기록되고, 값이 0~100 범위 내이며 기존 값과 비교했을 때 유의미한 차이가 있음을 확인.

```bash
npx tsx src/etl/jobs/build-market-breadth.ts
```

### 단계 4: 백필 가이드 주석 추가 (구현 에이전트)

**완료 기준**: `scripts/backfill-market-breadth.ts` 상단에 "v2 전환 이후 전체 재백필 시 `--from 2025-01-01`로 실행" 가이드 주석이 추가됨.

## 리스크

**1. `fetchWindow252V2()` 내 파생 계산의 시간 정렬 주의**
DESC 정렬이므로 배열 index 0이 최신(어제), index 4가 5일 전이다. `phase2Momentum5d` 계산 시 `phase2Ratios[i] - phase2Ratios[i+4]`를 잘못 역전하면 모멘텀 부호가 반대가 된다. 테스트로 명시적으로 검증할 것.

**2. 오늘 당일 데이터를 직전 4일과 합산하는 로직의 복잡성**
`netPhaseFlow5d`와 `adNet5d`는 오늘 당일 값(이미 계산된 변수)과 DB에서 조회한 직전 4일 값을 합산한다. 이 계산이 `buildMarketBreadth()` 내부의 올바른 순서(당일 A/D, Phase transition 집계 완료 이후)에 위치해야 한다.

**3. phase1_to2_count_1d, phase2_to3_count_1d 과거 데이터 null**
이 컬럼들은 비교적 최근에 추가됐다. 과거 날짜 백필 시 null이 있을 수 있다. null은 0으로 처리하도록 설계에 명시되어 있으므로, 구현 시 null 처리를 누락하지 않도록 주의.

**4. 백필 재실행 타이밍**
v2 구현 완료 후 과거 행을 재백필해야 점수 시계열이 일관성을 갖는다. 그 전까지는 과거 행은 v1 점수, 신규 행만 v2 점수인 혼재 상태가 된다. 이 혼재 기간 동안의 `computeDivergenceSignal()`은 5일 전 breadthScore가 v1일 수 있어 신호 신뢰도가 낮다. 백필은 이 기획과 별도 이슈로 즉시 추진 권장.

**5. VIX 데이터 없는 날**
미국 시장 휴일에는 VIX 데이터가 없다. 이 경우 기존 `fetchFearGreed()` null 처리와 동일한 방식으로 나머지 4개 가중치를 재정규화한다. 이미 설계에 포함.

## 커밋 단위 계획

| # | 커밋 메시지 | 포함 파일 |
|---|------------|-----------|
| 1 | `feat: Breadth Score v2 핵심 로직 구현` | `src/etl/jobs/build-market-breadth.ts` |
| 2 | `test: Breadth Score v2 단위 테스트 추가` | `src/etl/jobs/__tests__/build-market-breadth.test.ts` |
| 3 | `chore: breadth score 백필 스크립트 v2 전환 가이드 주석 추가` | `scripts/backfill-market-breadth.ts` |

## 의사결정 필요

없음 — CEO 승인된 설계를 그대로 기획서로 확정. 바로 구현 가능.
