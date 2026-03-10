# Breakout/Noise ETL 윈도우 함수 정확성 + 타임아웃 버그 수정

## 선행 맥락

- PR #61 (tool-validation): `getPhase1LateStocks` 전환율 41.9%, `getRisingRS` 20.3% 검증 완료.
  breakout signal이 핵심 포착 도구 중 하나로 확인됨.
- PR #63 (bias-mitigation): 편향 감지 시스템 구축. 정확한 signal이 전제.
- daily_ma 테이블: Build Daily MA step에서 ma20/ma50/ma200/vol_ma30 미리 계산됨.
  ETL 파이프라인: Daily Prices → Daily MA → RS → Ratios → (병렬) Breakout/Noise/Phases.
- 인덱스 현황: `idx_daily_prices_symbol_date (symbol, date)`, `idx_daily_ma_symbol_date (symbol, date)`.
  date 컬럼은 timestamp 타입 — `date::date` 캐스트 시 인덱스 미활용.

## 골 정렬

ALIGNED — breakout/noise signal은 Phase 2 주도주 초입 포착의 핵심 도구.
현재 버그로 인해 signal 자체가 잘못 계산되고 있음 → 수정 없이 운영 지속 불가.

## 문제

### 1. build-breakout-signals.ts — 정확성 버그

`yesterday_with_windows` CTE에서 윈도우 함수를 WHERE로 1일만 필터한 후 실행:
- `MAX(dp.high) OVER (ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)` → 실제로는 1행만 존재
- `high_20d` = 당일 고가, `avg_volume_20d` = 당일 거래량 (의도한 20일 값이 아님)
- `confirmed_breakout` 조건 `close >= high_20d` → "종가 = 당일 고가"인 종목만 통과 (상한봉 필터)
- `vol_ma30`이 `daily_ma`에 이미 계산되어 있으나 미활용

### 2. build-breakout-signals.ts — 성능 버그

- `past_breakouts_retest` CTE: 상관 EXISTS 서브쿼리 + HAVING 조합 → 풀스캔 위험
- 곳곳의 `date::date` 캐스트: 인덱스 컬럼에 함수 적용 → 인덱스 무력화
- statement_timeout 120초 초과 발생 (맥미니 ETL 실측)

### 3. build-noise-signals.ts — 동일 패턴

- `volume_metrics` CTE: AVG 윈도우 함수 + 1일 필터 → avg_volume_20d 오계산
- `atr_calc`, `bb_calc` CTE: 60~80일 범위 전체 스캔 + 윈도우 함수 → 타임아웃 위험
- `date::date` 캐스트 다수

## Before → After

**Before**
- `high_20d` = 당일 고가 (20일 고가 X)
- `avg_volume_20d` = 당일 거래량 (20일 평균 X)
- confirmed_breakout: "종가 = 고가" 종목만 잡힘
- 쿼리 120초 타임아웃 → ETL step 실패

**After**
- `high_20d` = 최근 20거래일 실제 MAX(high) — 서브쿼리 방식
- `avg_volume_20d` = daily_ma.vol_ma30 재활용 (이미 계산된 값)
- confirmed_breakout: "종가 >= 20일 고가" 진짜 신고가 돌파
- `past_breakouts_retest`: 상관 서브쿼리 제거, pre-aggregated CTE로 대체
- noise: atr/bb도 서브쿼리 또는 분리 방식으로 정확성 + 성능 보장
- 전 구간 `date::date` 캐스트 제거 → 인덱스 활용

## 변경 사항

### build-breakout-signals.ts

1. **`yesterday_with_windows` 제거** — 윈도우 함수 CTE 전체 삭제
2. **`high_20d` 계산**: 서브쿼리로 최근 20거래일 MAX(high) 조회
   ```sql
   (SELECT MAX(dp2.high)
    FROM daily_prices dp2
    WHERE dp2.symbol = dp.symbol
      AND dp2.date >= (target_date - INTERVAL '28 days')
      AND dp2.date <= target_date
    LIMIT 20 거래일 기준)
   ```
   실용적 대안: `INTERVAL '28 days'` (20거래일 ≈ 4주)로 근사. 정확도 vs 성능 트레이드오프 수용.
3. **`avg_volume_20d`**: `daily_ma.vol_ma30` 직접 활용 (vol_ma30은 30일 평균 — BREAKOUT_CONFIG.VOLUME_WINDOW_DAYS=20과 근사)
   - 또는 daily_prices JOIN으로 직접 계산 (BREAKOUT_CONFIG 수치 일치 중요하면)
   - **판단**: vol_ma30 재활용으로 통일. 20일/30일 차이 허용 (성능 우선).
4. **`past_breakouts_retest`**: 상관 EXISTS 제거
   - 방법: 3~10일 전 구간을 그룹 집계 CTE로 만든 후 JOIN
   - `MAX(dp2.high)` 미리 집계 → per-symbol 20일 고가 계산 후 JOIN
5. **`date::date` 캐스트 전 구간 제거**: date 컬럼이 timestamp면 `>= '2025-01-01'::date` 형태로 비교
6. **targetDate 파라미터화**: 상단에서 계산한 `previousDate` 값을 SQL에 직접 바인딩. CTE 내 `MAX(date)` 연쇄 제거.

### build-noise-signals.ts

1. **`volume_metrics`**: daily_ma.vol_ma30 재활용 (AVG 윈도우 + 1일 필터 제거)
2. **`atr_calc`**: 1일 필터 추가 (WHERE d = target_date) 로 스캔 범위 축소
   - ATR 14일 계산은 직전 14거래일 필요 → `INTERVAL '20 days'`로 범위 제한
3. **`bb_calc`**: 마찬가지로 범위 축소. BB 20일 + 평균 60일 = 약 90거래일 → `INTERVAL '130 days'`
4. **`date::date` 캐스트 전 구간 제거**
5. **targetDate 파라미터화**: `latestDate`를 SQL 바인딩으로 직접 전달

### 공통

- `BREAKOUT_CONFIG.VOLUME_WINDOW_DAYS`를 vol_ma30으로 대체 시 상수 주석에 명시
- 변경 후 실제 계산값 로그 추가 (몇 개 symbol 샘플 출력)

## 작업 계획

### Step 1: build-breakout-signals.ts 수정 [구현팀]
- `yesterday_with_windows` CTE 제거
- `targetDate = previousDate` 바인딩으로 SQL 상단 CTE 단순화
- `high_20d`: 서브쿼리 (28일 범위 MAX)로 교체
- `avg_volume_20d`: `daily_ma.vol_ma30` JOIN으로 대체
- `past_breakouts_retest`: 상관 EXISTS 제거 → 집계 CTE + JOIN 방식
- `date::date` 전 구간 제거
- 완료 기준: 쿼리 실행 성공, 결과 rows > 0, 30초 이내

### Step 2: build-noise-signals.ts 수정 [구현팀]
- `volume_metrics` AVG 윈도우 → `daily_ma.vol_ma30` 재활용
- `atr_calc` 스캔 범위 축소 (INTERVAL '20 days')
- `bb_calc` 스캔 범위 `INTERVAL '130 days'`로 명시 제한
- `date::date` 전 구간 제거
- targetDate 바인딩
- 완료 기준: 쿼리 실행 성공, VCP 결과 비율 합리적 (전체 대비 1~10%), 30초 이내

### Step 3: 검증 [구현팀]
- 수정 전/후 같은 날짜 기준 결과 비교 (symbol 수, breakout %, volume_ratio 분포)
- 특정 알려진 breakout 사례 (역사적 데이터) 로 정합성 spot-check
- 완료 기준: 수정 전 "confirmed_breakout 종목 = 당일 고가 종목"이었던 것이 수정 후 다양하게 분포

### Step 4: 코드 리뷰 + PR [pr-manager]
- code-reviewer 실행
- PR 생성

## 리스크

- **vol_ma30 vs vol_ma20 불일치**: vol_ma30은 30일 평균이나 VOLUME_MULTIPLIER 기준(2x)을 적용하면 실질 차이 미미. 허용.
- **28일 근사**: 최근 20거래일 ≈ 28달력일. 공휴일 집중 시기 오차 ±1~2거래일 가능. ATR/BB 정확도와 동일 수준의 근사값으로 수용.
- **past_breakouts_retest 재설계**: 로직 변경이 크므로 의도한 retest 패턴과 결과 합치 확인 필요.
- **daily_ma 빌드 순서 의존**: vol_ma30 활용 시 Build Daily MA가 먼저 완료되어야 함 — 현재 ETL 순서 (Daily MA → Breakout/Noise)와 일치하므로 문제 없음.

## 의사결정 필요

없음 — 범위 명확한 버그 수정. 자율 판단으로 진행.
