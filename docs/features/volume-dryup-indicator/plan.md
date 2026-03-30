# Plan: Volume Dry-Up 지표 추가 (Phase 2 초입 정확도 향상)

**이슈:** #509
**트랙:** Lite (기존 ETL 확장, 아키텍처 변경 없음)
**날짜:** 2026-03-30

---

## 문제 정의

`findPhase1LateStocks`가 `vol_ratio >= 1.5` (당일 거래량 / 30일 MA) 조건만 사용하여 Phase 1→2 전환 후보를 필터링한다.

Minervini SEPA 핵심 원칙: Phase 1 후기에 **거래량이 극도로 줄어들고(dry-up)**, 이후 돌파 시 거래량이 폭발(volume surge)하는 패턴이 Phase 2 전환의 가장 신뢰할 수 있는 신호. 현재 시스템은 surge만 감지하고 dry-up(축적 완료 신호)은 미감지.

**결과:** 단기 이벤트 급등(noise)과 축적 완료 돌파(signal)를 구분하지 못해 false positive 발생.

---

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `stock_phases` 컬럼 | `vol_ratio` only | `vol_ratio` + `vdu_ratio` |
| ETL 계산 | 당일 거래량/MA30 | + 5일 평균 거래량/50일 평균 거래량 |
| Phase1Late 필터 | `vol_ratio >= 1.5` | `vol_ratio >= 1.0` AND 최근 20거래일 내 `vdu_ratio <= 0.5`인 기록 3일+ |
| 에이전트 출력 | volRatio만 | + vduRatio, hadRecentDryup |

**핵심 변경:** 기존 `vol_ratio >= 1.5`를 **대체하지 않고** `vol_ratio >= 1.0`으로 완화 + dry-up 이력 조건을 AND로 추가. 즉, "최근에 거래량 고갈 구간이 있었고 + 현재 거래량이 평균 이상" 패턴을 감지.

vol_ratio 임계값을 1.5에서 1.0으로 완화하는 이유: dry-up 후 재차 증가하는 거래량은 아직 1.5x에 못 미칠 수 있으나, dry-up 이력이 있다면 1.0x(평균 수준 회복)만으로도 축적 완료 신호로 충분.

---

## 변경 사항

### 1. 스키마 (`src/db/schema/analyst.ts`)
- `stock_phases`에 `vdu_ratio` 컬럼 추가 (numeric, nullable)

### 2. 마이그레이션 (`db/migrations/0025_volume_dryup.sql`)
- `ALTER TABLE stock_phases ADD COLUMN vdu_ratio numeric;`

### 3. ETL (`src/etl/jobs/build-stock-phases.ts`)
- 배치별 최근 50거래일 거래량 이력 조회 (새 쿼리 `findVolumeHistoryForBatch`)
- VDU ratio 계산: 5일 평균 거래량 / 50일 평균 거래량
- upsert에 `vdu_ratio` 포함

### 4. 레포지토리 (`src/db/repositories/stockPhaseRepository.ts`)
- `findVolumeHistoryForBatch(symbols, targetDate, days=50)` 추가
- `findPhase1LateStocks` SQL 수정:
  - `vol_ratio >= 1.5` → `vol_ratio >= 1.0`
  - 서브쿼리 추가: 최근 20거래일 내 `vdu_ratio <= 0.5`인 날이 3일 이상
  - SELECT에 `vdu_ratio` 포함

### 5. 타입 (`src/db/repositories/types.ts`)
- `Phase1LateStockRow`에 `vdu_ratio` 필드 추가
- `EtlVolumeHistoryRow` 타입 추가

### 6. 도구 (`src/tools/getPhase1LateStocks.ts`)
- 출력에 `vduRatio`, `hadRecentDryup` 추가
- description 업데이트

---

## 작업 계획

| # | 작업 | 파일 |
|---|------|------|
| 1 | 스키마 + 마이그레이션 | `analyst.ts`, `0025_volume_dryup.sql` |
| 2 | 타입 추가 | `types.ts` |
| 3 | 레포지토리: `findVolumeHistoryForBatch` 추가 | `stockPhaseRepository.ts` |
| 4 | ETL: VDU ratio 계산 + upsert 확장 | `build-stock-phases.ts` |
| 5 | 레포지토리: `findPhase1LateStocks` 필터 수정 | `stockPhaseRepository.ts` |
| 6 | 도구: 출력 확장 | `getPhase1LateStocks.ts` |
| 7 | 테스트 업데이트 | `getPhase1LateStocks.test.ts` |

---

## 리스크

| 리스크 | 대응 |
|--------|------|
| ETL 성능: 50일 거래량 히스토리 배치 조회 | `daily_prices`에 `idx_daily_prices_symbol_date` 인덱스 존재, 배치 200개씩이므로 문제 없음 |
| 마이그레이션: 기존 데이터 | nullable 컬럼이므로 기존 행 영향 없음. 첫 ETL 실행 전까지 NULL → 쿼리에서 COALESCE 처리 |
| vol_ratio 임계값 완화 | 1.0은 "평균 수준 회복"이므로 dry-up 이력과 AND 결합 시 합리적 |
| OBV 미포함 | 누적 지표라 ETL 구조 변경이 크고, VDU ratio만으로 1차 개선 충분. 후속 이슈로 분리 |

---

## 골 정렬

**ALIGNED** — Phase 2 초입 포착 정확도 향상은 시스템의 1번 골(주도섹터/주도주 남들보다 먼저 포착)에 직접 기여.

## 무효 판정

**해당 없음** — 기존 기능 강화이며, 새로운 외부 의존성 없음.
