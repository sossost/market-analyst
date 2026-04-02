# market_breadth_daily — ETL 스냅샷 테이블 도입

## 선행 맥락

관련 메모리 없음. 신규 인프라 개선 작업.

현재 `marketBreadthRepository.ts`는 총 16개 함수로 분화되어 있으며, 두 소비자의
필터 조건 차이(symbols JOIN 유무)로 인해 동일한 쿼리가 `getMarketBreadth` 버전과
`marketDataLoader` 버전으로 이중 관리되고 있다.
`findNewHighLow`는 365일 윈도우 CTE + JOIN + 필터를 매 호출마다 실행하는 구조.

## 골 정렬

**SUPPORT** — Phase 2 초입 포착의 직접 도구는 아니지만, 브레드스 데이터를
대시보드(control-tower)가 신뢰성 있게 소비하기 위한 인프라다. 현재 쿼리 지연이
대시보드 응답성을 저하시키면 분석 속도에 영향을 준다.

## 문제

- 브레드스 지표(Phase 분포, A/D ratio, 52주 신고가/신저가 등)가 매 요청마다 실시간 집계된다.
- `findNewHighLow`는 365일 윈도우 CTE로 가장 무거우며, 에이전트 툴(`getMarketBreadth`)과
  토론 엔진(`marketDataLoader`) 양쪽에서 중복 실행된다.

## Before → After

**Before**: 매 호출 시 `stock_phases` + `daily_prices` + `symbols` JOIN + 집계 쿼리.
`findNewHighLow`는 ~50만 행 CTE를 매번 실행.

**After**: ETL이 일 1회 집계하여 `market_breadth_daily`에 저장. 소비자는
`SELECT * FROM market_breadth_daily WHERE date = $1` 단순 조회. 백필 스크립트로
기존 데이터 소급 처리.

## 변경 사항

1. **Drizzle 스키마 추가** — `src/db/schema/analyst.ts`에 `marketBreadthDaily` 테이블 정의
2. **Drizzle 마이그레이션 생성** — `drizzle generate` + `drizzle migrate`
3. **ETL job 신설** — `src/etl/jobs/build-market-breadth.ts`
4. **백필 스크립트 신설** — `scripts/backfill-market-breadth.ts`
5. **레포지토리 함수 추가** — `marketBreadthRepository.ts`에 `findMarketBreadthSnapshot` 추가
6. **소비자 전환** — `getMarketBreadth.ts`, `marketDataLoader.ts` 신규 테이블 조회로 전환

## 소비자 전환 전략

### 접근: 신규 함수 추가 후 점진 전환 (기존 함수 보존)

`findNewHighLow`, `findPhaseDistribution` 등 기존 함수를 즉시 삭제하지 않는다.
신규 `findMarketBreadthSnapshot(date)` 함수를 추가하고,
두 소비자(`getMarketBreadth.ts`, `marketDataLoader.ts`)에서 이 함수로 전환한다.

기존 16개 함수는 이번 PR에서 삭제하지 않는다 (쿼리 로직 사라지는 것에 대한
안전망 + 향후 추가 소비자가 필요할 수 있음). 단, 사용처가 0이 되면 별도 이슈로 정리.

### getMarketBreadth.ts 전환 전략

현재 daily 모드는 함수 6개를 순차 호출, weekly 모드는 7개 이상 호출.
신규 테이블 도입 후:
- daily 모드: `findMarketBreadthSnapshot(date)` 단일 조회 → 결과를 기존 출력 포맷으로 매핑
- weekly 모드: `findMarketBreadthSnapshots(dates[])` 배치 조회 → weeklyTrend 매핑

topSectors는 `market_breadth_daily`에 포함되지 않으므로 `findBreadthTopSectors` 계속 사용.
`findNewPhase2Stocks`, `findTopPhase2Stocks` (marketDataLoader.ts용)도 변경 없음.

### marketDataLoader.ts 전환 전략

`loadMarketBreadth` 내 4개 Repository 호출(`findMarketBreadthPhaseDistribution`,
`findMarketBreadthPrevPhase2`, `findMarketBreadthAvgRs`, `findMarketBreadthAdvanceDecline`,
`findMarketBreadthNewHighLow`)을 `findMarketBreadthSnapshot(date)` 단일 호출로 교체.

`findSectorSnapshot`, `findNewPhase2Stocks`, `findTopPhase2Stocks`, `findPrevDayDate`,
`findIndustryDrilldown`은 `market_breadth_daily` 범위 외 — 변경 없음.

### 두 소비자의 필터 불일치 해소

기존 불일치(getMarketBreadth는 symbols JOIN 3필터 포함, marketDataLoader는 미포함)를
ETL job에서 symbols JOIN 포함 버전으로 통일한다.
`getMarketBreadth.ts`의 `findPhaseDistribution`(symbols 필터 포함)이 기준.

## 작업 계획

### Task 1 — Drizzle 스키마 정의

**담당**: 구현팀
**파일**: `src/db/schema/analyst.ts`

`marketBreadthDaily` 테이블을 `analyst.ts` 하단에 추가.

```typescript
export const marketBreadthDaily = pgTable("market_breadth_daily", {
  date: date("date").primaryKey(),
  totalStocks:         integer("total_stocks").notNull(),
  phase1Count:         integer("phase1_count").notNull(),
  phase2Count:         integer("phase2_count").notNull(),
  phase3Count:         integer("phase3_count").notNull(),
  phase4Count:         integer("phase4_count").notNull(),
  phase2Ratio:         numeric("phase2_ratio", { precision: 5, scale: 2 }).notNull(),
  phase2RatioChange:   numeric("phase2_ratio_change", { precision: 5, scale: 2 }),
  phase1To2Count5d:    integer("phase1_to2_count_5d"),
  marketAvgRs:         numeric("market_avg_rs", { precision: 5, scale: 2 }),
  advancers:           integer("advancers"),
  decliners:           integer("decliners"),
  unchanged:           integer("unchanged"),
  adRatio:             numeric("ad_ratio", { precision: 6, scale: 2 }),
  newHighs:            integer("new_highs"),
  newLows:             integer("new_lows"),
  hlRatio:             numeric("hl_ratio", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

`src/db/schema/index.ts`에서 export 확인 (analyst.ts 전체 re-export 이미 되어 있음).

**AC**:
- `npx drizzle-kit generate` 실행 시 migration SQL 파일이 생성된다
- 스키마 컬럼이 이슈 #588 명세와 1:1 일치한다

---

### Task 2 — Drizzle 마이그레이션 실행

**담당**: 구현팀
**의존**: Task 1

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

**AC**:
- `market_breadth_daily` 테이블이 DB에 생성된다
- `npx drizzle-kit introspect` 혹은 `\d market_breadth_daily` 로 컬럼 확인 가능하다

---

### Task 3 — ETL job 신설: build-market-breadth.ts

**담당**: 구현팀
**파일**: `src/etl/jobs/build-market-breadth.ts`
**의존**: Task 2

집계 로직은 `getMarketBreadth.ts` daily 모드의 symbols JOIN 버전을 기준으로 단일 트랜잭션 내 SQL로 작성한다.
날짜 인수 없으면 `getLatestPriceDate()`로 자동 해결.

포함해야 할 계산:
- phase별 count: `stock_phases` JOIN `symbols` (is_actively_trading=true, is_etf=false, is_fund=false)
- `phase2_ratio_change`: 전일 `market_breadth_daily.phase2_ratio`에서 차감 (stock_phases 재집계 아님)
- `phase1_to2_count_5d`: 당일 포함 최근 5거래일의 `stock_phases` WHERE prev_phase=1 AND phase=2
- `market_avg_rs`: `stock_phases.rs_score` AVG
- `advancers/decliners/unchanged`: `daily_prices` self-join (기존 `findAdvanceDecline`과 동일)
- `new_highs/new_lows`: 365일 CTE (기존 `findNewHighLow`와 동일)
- `ad_ratio`: decliners > 0 ? advancers / decliners : NULL
- `hl_ratio`: new_lows > 0 ? new_highs / new_lows : NULL

upsert 방식:
```sql
INSERT INTO market_breadth_daily (...) VALUES (...)
ON CONFLICT (date) DO UPDATE SET ...
```

**AC**:
- `npx tsx src/etl/jobs/build-market-breadth.ts` 실행 시 오늘 날짜 행이 INSERT/UPDATE된다
- `phase2_ratio` 값이 기존 `findPhaseDistribution` 결과와 오차 0.1% 미만이다
- 에러 발생 시 EXIT 1과 의미 있는 오류 메시지가 출력된다
- DB에 이미 같은 날짜가 있으면 에러 없이 UPDATE된다 (멱등성)

---

### Task 4 — 백필 스크립트: backfill-market-breadth.ts

**담당**: 구현팀
**파일**: `scripts/backfill-market-breadth.ts`
**의존**: Task 3

`backfill-etl.ts` 패턴 참조:
- `--from YYYY-MM-DD`: 특정 날짜부터 백필
- `--limit N`: 최대 N일
- `--dry-run`: 대상 날짜만 출력

대상 날짜 선정 로직:
```sql
SELECT DISTINCT sp.date::text AS date
FROM stock_phases sp
WHERE NOT EXISTS (
  SELECT 1 FROM market_breadth_daily mbd WHERE mbd.date::text = sp.date::text
)
ORDER BY date ASC
```

날짜별로 `build-market-breadth.ts`의 집계 함수를 순차 호출.
성공/실패 카운터 출력.

**AC**:
- `--dry-run`으로 누락 날짜 목록이 출력된다
- 실행 후 `market_breadth_daily` 행 수가 `stock_phases`의 distinct date 수와 일치한다
- 중간 실패 시 해당 날짜만 스킵하고 나머지를 계속 처리한다 (전체 롤백 없음)

---

### Task 5 — 레포지토리 함수 추가

**담당**: 구현팀
**파일**: `src/db/repositories/marketBreadthRepository.ts`
**의존**: Task 2

단일 날짜 조회:
```typescript
export async function findMarketBreadthSnapshot(
  date: string,
): Promise<MarketBreadthDailyRow | null>
```

배치 조회 (weekly 모드용):
```typescript
export async function findMarketBreadthSnapshots(
  dates: string[],
): Promise<MarketBreadthDailyRow[]>
```

`MarketBreadthDailyRow` 타입은 `src/db/repositories/types.ts`에 추가.
`src/db/repositories/index.ts`에서 export.

**AC**:
- 날짜가 없으면 `findMarketBreadthSnapshot`은 `null`을 반환한다 (throw 아님)
- 반환 타입이 `market_breadth_daily` 컬럼과 1:1 대응된다

---

### Task 6 — getMarketBreadth.ts 소비자 전환

**담당**: 구현팀
**파일**: `src/tools/getMarketBreadth.ts`
**의존**: Task 5

**daily 모드** 전환:
- 기존: `findPhaseDistribution`, `findPrevDayPhase2Ratio`, `findMarketAvgRs`, `findAdvanceDecline`, `findNewHighLow` (5개 호출)
- 신규: `findMarketBreadthSnapshot(date)` 단일 호출 → null이면 기존 폴백 경로 실행

**weekly 모드** 전환:
- `findWeeklyTrend`, `findWeeklyPhase1to2Transitions` → `findMarketBreadthSnapshots(dates)` 배치 조회
- `latestSnapshot`의 advancers/decliners/newHighs/newLows → 스냅샷에서 직접 읽기

**topSectors**: 변경 없음 (`findBreadthTopSectors` 유지).

출력 포맷 변경 없음 — `getMarketBreadth`의 JSON 응답 구조는 동일하게 유지.

**AC**:
- 기존 출력과 동일한 JSON 구조를 반환한다
- `market_breadth_daily`에 해당 날짜 데이터가 없으면 기존 집계 쿼리로 폴백한다 (graceful degradation)
- `phase2Ratio`, `advancers`, `newHighs` 값이 기존 집계 결과와 오차 0.1% 미만이다

---

### Task 7 — marketDataLoader.ts 소비자 전환

**담당**: 구현팀
**파일**: `src/debate/marketDataLoader.ts`
**의존**: Task 5

`loadMarketBreadth` 함수 내 5개 Repository 호출을 `findMarketBreadthSnapshot(date)` 단일 호출로 교체.
null 반환 시 기존 개별 쿼리 폴백 유지.

변경하지 않는 함수:
- `findSectorSnapshot`
- `findNewPhase2Stocks` / `findTopPhase2Stocks`
- `findPrevDayDate`
- `findIndustryDrilldown`

**AC**:
- `loadMarketBreadth` 반환 타입(`MarketBreadthSnapshot`)이 변경 없이 유지된다
- 기존 테스트(`marketDataLoader.drilldown.test.ts`)가 그린을 유지한다
- 스냅샷 null 시 폴백이 동작한다

---

### Task 8 — ETL 실행 순서 등록

**담당**: 구현팀
**파일**: 기존 ETL 오케스트레이터 또는 launchd plist

`build-stock-phases.ts` 완료 → `build-market-breadth.ts` 실행 순서 보장.

현재 ETL 오케스트레이터 실행 순서 확인 후 `build-market-breadth` 를 적절한 위치에 삽입.
`build-sector-rs.ts` 이전 또는 이후 여부는 코드 확인 후 결정 (phase2_ratio_change 계산이
market_breadth_daily 전일 행에 의존하므로 stock-phases 직후면 충분).

**AC**:
- 매일 ETL 실행 시 `market_breadth_daily`에 당일 행이 자동 생성된다
- `build-stock-phases` 완료 전 `build-market-breadth`가 실행되지 않는다

---

## 리스크

| 항목 | 내용 |
|------|------|
| symbols 필터 통일 | 두 소비자의 필터 불일치(symbols JOIN 유무)를 ETL job에서 JOIN 포함 버전으로 통일. 이에 따라 marketDataLoader 수치가 소폭 변경될 수 있음 (실제 트레이딩 종목만 집계). 허용 가능한 변화로 판단. |
| phase2_ratio_change 계산 | 전일 `market_breadth_daily` 행에서 차감하므로, 백필 시 날짜 순 오름차순 처리 필수. 첫 번째 백필 날짜는 전일 행 없으면 NULL. |
| 폴백 유지 기간 | 소비자 전환 후 `market_breadth_daily`가 없는 날짜(백필 이전 극히 오래된 데이터)에 대한 폴백이 필요. 백필 완료 확인 후 폴백 제거는 별도 이슈로. |
| weekly 모드 dates 변경 없음 | weekly 모드는 `findTradingDates`로 날짜 목록을 조회한다. 이 쿼리는 `stock_phases` 기반이며 변경 없음. |

## 의사결정 필요

없음 — 바로 구현 가능
