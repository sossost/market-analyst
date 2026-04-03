# Plan: Phase 2 전환 시 거래량 돌파 확인 강화

## 골 정렬

- **정렬**: ALIGNED — Weinstein Stage 2 진입 시 거래량 동반 확인은 주도주 발굴 정밀도 직결
- **무효 판정**: VALID — 구조적 빈 공간(전환 순간 거래량 확인 부재)을 채우는 피처

## 문제 정의

Weinstein Stage 2의 핵심 진입 조건은 "거래량을 실으며 30주선(MA150)을 돌파하는 순간"이다.
현재 시스템은 Phase 2 판정(8개 조건) 후 `volumeConfirmed`를 사후 라벨로 계산하지만:

1. **전환 순간 감지 없음** — "전주 ≠ Phase 2 → 금주 = Phase 2" 전환 이벤트를 명시적으로 추적하지 않음
2. **거래량 확인이 일봉 단일 기준** — 당일 `volRatio`만으로 판단하여 주간 관점 부재
3. **사후 라벨에 불과** — `volumeConfirmed`가 에이전트 프롬프트에서만 참조, 관심종목 게이트에 실질 반영 없음

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 전환 감지 | prevPhase로 사후 비교 | `breakoutSignal` 필드로 전환 이벤트 명시적 태깅 |
| 거래량 기준 | 당일 volRatio 단일 | 주간 누적 거래량 / N주 평균 주간 거래량 |
| volumeConfirmed 로직 | 당일 volRatio >= 2.0 (sticky) | 주간 volRatio 기반 + 기존 일봉 보조 |
| 에이전트 주입 | [거래량 확인] 라벨만 | [돌파 확인] / [거래량 미확인] 구분 강화 |

## 설계 원칙

1. **Phase 2 판정 로직 변경 없음** — `phase-detection.ts`는 건드리지 않음
2. **신규 필드 추가, 기존 필드 변경 없음** — `volumeConfirmed` 기존 의미 유지, 새 `breakoutSignal` 추가
3. **주봉 기준** — Weinstein 원전에 맞게 주간 누적 거래량 vs 주간 평균 비교
4. **기존 daily ETL 내 통합** — 별도 주간 ETL 없이, daily build-stock-phases에서 주간 거래량 계산

## 변경 사항

### 1. `resolveVolumeConfirmed()` 주간 거래량 지원 강화

**파일**: `src/etl/utils/common.ts`

- 새 함수 `resolveBreakoutSignal()` 추가
- 입력: phase, prevPhase, volRatio(일봉), weeklyVolRatio(주봉)
- 출력: `'confirmed' | 'unconfirmed' | null`
  - `confirmed`: Phase 2 신규 전환 + 주간 거래량 >= 1.5x (또는 일봉 volRatio >= 2.0)
  - `unconfirmed`: Phase 2 신규 전환이지만 거래량 미동반
  - `null`: Phase 2가 아니거나 전환이 아닌 계속 보유
- 기존 `resolveVolumeConfirmed()` 로직 변경 없음 (하위 호환)

### 2. 주간 거래량 비율 계산

**파일**: `src/etl/jobs/build-stock-phases.ts`

- 기존 `volHistBySymbol` 데이터 활용 (이미 50일 거래량 이력 fetch 중)
- 최근 5거래일 합계 vs 이전 N주(4주=20일) 주간 평균 비교
- `weeklyVolRatio` = 최근 5일 합 / (이전 20일 합 / 4)

### 3. DB 스키마: `breakout_signal` 컬럼 추가

**파일**: `src/db/schema/analyst.ts`

- `stock_phases` 테이블에 `breakoutSignal: text("breakout_signal")` 추가
- 마이그레이션 생성

### 4. build-stock-phases ETL 연결

**파일**: `src/etl/jobs/build-stock-phases.ts`

- `resolveBreakoutSignal()` 호출 추가
- upsert에 `breakoutSignal` 포함

### 5. 에이전트 프롬프트 강화

**파일**: `src/debate/marketDataLoader.ts`

- `Phase2Stock` 인터페이스에 `breakoutSignal` 추가
- `formatStockLine()`에서 breakoutSignal 기반 라벨 강화
- confirmed → "[돌파 확인✓]", unconfirmed → "[거래량 미확인]"

### 6. 리포지토리 쿼리 업데이트

**파일**: `src/db/repositories/marketBreadthRepository.ts`

- `findNewPhase2Stocks`, `findTopPhase2Stocks` 쿼리에 `breakout_signal` 추가

## 작업 계획

| # | 작업 | 파일 | 의존성 |
|---|------|------|--------|
| 1 | `resolveBreakoutSignal()` + `calculateWeeklyVolRatio()` 함수 추가 + 테스트 | `common.ts`, 테스트 | 없음 |
| 2 | DB 스키마 + 마이그레이션 | `analyst.ts`, migration | 없음 |
| 3 | build-stock-phases ETL 연결 | `build-stock-phases.ts` | 1, 2 |
| 4 | 리포지토리 쿼리 업데이트 | `marketBreadthRepository.ts` | 2 |
| 5 | 에이전트 프롬프트 강화 | `marketDataLoader.ts` | 4 |
| 6 | 기존 테스트 호환성 확인 | 테스트 | 1-5 |

## 리스크

1. **volRatio 임계값 1.5x** — 업종별 편차 있음. 상수로 추출하여 향후 조정 여지 확보
2. **주간 거래량 데이터 부족** — 신규 상장/데이터 결손 시 null 처리. breakoutSignal도 null
3. **기존 volumeConfirmed 소비처** — 변경 없이 유지. breakoutSignal은 별도 필드로 추가
4. **Phase 3→2 전환** — Phase 1→2뿐 아니라 모든 비-Phase2 → Phase 2 전환 포함 (풀백 재진입 커버)
