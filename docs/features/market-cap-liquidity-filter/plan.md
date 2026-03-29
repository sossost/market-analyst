# Plan: 추천 시스템 시가총액 필터 추가

## 문제 정의

90일간 추천 14건 중 7건(50%)이 Phase Exit로 종료, 평균 보유 기간 2일.
Phase Exit 종목의 공통 특성: $1~$30 저가/소형주로 유동성 부족 → MA/Phase 조건이 1~2일 만에 깨짐.

**근본 원인**: Phase 2/Phase 1 Late/Rising RS 쿼리 3개 + 시그널 자동 기록(`findPhase1to2Transitions`)에 시가총액 필터가 전혀 없음.

**불일치**: 토론 에이전트 경로(`marketDataLoader.ts`)에는 이미 `MIN_MARKET_CAP = 300_000_000` 필터가 적용되어 있으나, 에이전트 도구 쿼리와 시그널 기록에는 미적용.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `findPhase2Stocks` | 시가총액 필터 없음 | $300M+ 필터 |
| `findPhase1LateStocks` | 시가총액 필터 없음 | $300M+ 필터 |
| `findRisingRsStocks` | 시가총액 필터 없음 | $300M+ 필터 |
| `findPhase1to2Transitions` | 시가총액 필터 없음 | $300M+ 필터 |
| `marketDataLoader.ts` | 로컬 `MIN_MARKET_CAP` 상수 | 공통 상수 참조 |
| `earlyDetectionLoader.ts` | 필터 없이 호출 | 간접적으로 적용 (쿼리에서 필터) |

## 변경 사항

### 1. 공통 상수 추출

`src/lib/constants.ts`에 `MIN_MARKET_CAP` 상수 정의.

### 2. `stockPhaseRepository.ts` — 4개 쿼리 수정

| 함수 | 변경 내용 |
|------|----------|
| `findPhase2Stocks` (L60) | `JOIN symbols s` 이미 존재. WHERE에 `s.market_cap >= $N` 추가 |
| `findPhase1LateStocks` (L293) | `JOIN symbols s` 이미 존재. WHERE에 동일 조건 추가 |
| `findRisingRsStocks` (L239) | `JOIN symbols s` 이미 존재. WHERE에 동일 조건 추가 |
| `findPhase1to2Transitions` (L564) | `JOIN symbols sym` 이미 존재. WHERE에 동일 조건 추가 |

**NULL 정책**: `market_cap IS NULL`인 종목은 **제외**. 데이터 없는 종목은 유동성 판단 불가이므로 안전한 방향.

- 토론 경로(`marketBreadthRepository.ts:414`)는 `market_cap IS NULL OR market_cap >= $2`로 NULL 허용 중이나, 이는 시장 전체 현황 파악 목적이므로 정책이 다름.
- 추천/시그널 경로는 실제 매매 의사결정에 사용되므로 더 보수적으로 NULL 제외.

### 3. `marketDataLoader.ts` — 상수 교체

로컬 `MIN_MARKET_CAP` 상수를 공통 상수 `import`로 교체.

### 4. 테스트 추가

- 기존 `getPhase1LateStocks.test.ts`, `getRisingRS.test.ts`에 시가총액 필터 SQL 포함 여부 테스트 추가
- `getPhase2Stocks.test.ts` 신규 작성 (기존 없음)

## 작업 계획

1. `src/lib/constants.ts` 생성 — `MIN_MARKET_CAP` 상수
2. `stockPhaseRepository.ts` — 4개 함수에 WHERE 조건 추가
3. `marketDataLoader.ts` — 공통 상수로 교체
4. 테스트 작성/수정
5. 타입 체크 + 테스트 실행

## 리스크

1. **시그널 수 감소**: `findPhase1to2Transitions` 필터 추가로 과거 대비 시그널 수가 줄어듦. 이는 의도된 동작이며, 노이즈 시그널 감소가 목적.
2. **거래대금 필터 미포함**: 시가총액 필터만으로 Phase Exit 비율 개선이 유의미한지 먼저 검증. 거래대금 필터는 `daily_noise_signals` JOIN 필요로 쿼리 복잡도가 증가하므로 2차로 판단.

## 골 정렬

- **ALIGNED** — Phase 2 초입 포착 정확도 향상이 직접 목표. 유동성 부족 종목의 노이즈 Phase 2 판정을 제거하여 추천 품질 개선.

## 무효 판정

- **해당 없음** — 시가총액 필터는 이미 토론 경로에서 검증된 기준($300M). 새로운 실험이 아닌 기존 불일치 해소.
