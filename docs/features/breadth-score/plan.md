# BreadthScore + 다이버전스 신호 ETL 및 에이전트 주입

GitHub Issue: #600

## 선행 맥락

없음. 신규 컬럼 추가 + 계산 로직 삽입 작업으로, 동일 주제의 기존 결정 없음.

## 골 정렬

**ALIGNED** — 시장 브레드스를 단일 숫자(0~100)로 압축하고 가격-브레드스 다이버전스를 자동 감지하면, 에이전트가 Phase 2 초입 진입/이탈 시점을 더 명확하게 포착할 수 있다. 특히 다이버전스 신호는 시장 가격이 숨기는 내부 강도 변화를 드러낸다.

## 문제

현재 에이전트는 phase2_ratio, ad_ratio, hl_ratio 등 개별 브레드스 지표를 분리된 숫자로 받아 직접 판단한다. 복합 강도를 단일 척도로 집약하는 도구가 없고, 가격과 브레드스 간 구조적 괴리(다이버전스)를 자동으로 감지하는 로직도 없다.

## Before → After

**Before**: market_breadth_daily에 개별 지표만 존재. 에이전트가 직접 5개 숫자를 종합해 판단.
**After**: breadth_score(0~100 복합 지수) + divergence_signal('positive'|'negative'|null)이 매일 ETL에서 계산되어 DB에 저장되고, getMarketBreadth 툴과 formatMarketSnapshot을 통해 에이전트에 노출됨.

## 변경 사항

### 파일 1: DB Migration (신규)
`db/migrations/0030_breadth_score.sql` (파일명은 drizzle generate 결과에 따라 다를 수 있음)

```sql
ALTER TABLE market_breadth_daily
  ADD COLUMN breadth_score     numeric(5,2),
  ADD COLUMN divergence_signal text;
```

### 파일 2: Drizzle 스키마
`src/db/schema/analyst.ts` — `marketBreadthDaily` 테이블 정의 (1182~1207행) 에 두 컬럼 추가:

```typescript
breadthScore:     numeric("breadth_score", { precision: 5, scale: 2 }),
divergenceSignal: varchar("divergence_signal", { length: 20 }),
```

### 파일 3: 타입 정의
`src/db/repositories/types.ts` — `MarketBreadthDailyRow` 인터페이스 (236~259행) 에 두 필드 추가:

```typescript
breadth_score: string | null;
divergence_signal: string | null;
```

### 파일 4: ETL (핵심 수정)
`src/etl/jobs/build-market-breadth.ts`

**추가할 함수: `fetchWindow252`**
```
목적: 직전 252거래일의 phase2_ratio, ad_ratio, hl_ratio, market_avg_rs, fear_greed_score 조회
쿼리: market_breadth_daily WHERE date < $targetDate ORDER BY date DESC LIMIT 252
반환: 각 지표의 값 배열 (null 포함)
```

**추가할 함수: `computePercentileRank(value, window)`**
```
목적: value가 window 배열에서 몇 번째 퍼센타일인지 계산 (0~100)
로직: window에서 null 제거 → value 이하인 원소 수 / 전체 수 × 100
순수 함수, DB 의존 없음
```

**추가할 함수: `computeBreadthScore(current, window252)`**
```
목적: BreadthScore 수식 계산

수식:
  phase2_pct = computePercentileRank(current.phase2Ratio, window252.phase2Ratios)
  ad_pct     = computePercentileRank(current.adRatio, window252.adRatios)
  hl_pct     = computePercentileRank(current.hlRatio, window252.hlRatios)
  rs_pct     = computePercentileRank(current.marketAvgRs, window252.marketAvgRs)
  fg_raw     = current.fearGreedScore  (이미 0~100, 퍼센타일 불필요)

  fear_greed null 처리:
    if fg_raw != null:
      score = phase2_pct×0.35 + fg_raw×0.20 + ad_pct×0.20 + hl_pct×0.15 + rs_pct×0.10
    else:
      weights = {phase2: 0.35, ad: 0.20, hl: 0.15, rs: 0.10} → 합 0.80
      각 가중치를 /0.80으로 재정규화 (phase2: 0.4375, ad: 0.25, hl: 0.1875, rs: 0.125)
      score = phase2_pct×0.4375 + ad_pct×0.25 + hl_pct×0.1875 + rs_pct×0.125

반환: number(소수점 2자리, 0~100 클램핑)
```

**추가할 함수: `fetchSpx5dChange(date)`**
```
목적: ^GSPC의 5일 변화율(%) 계산
쿼리: index_prices WHERE symbol = '^GSPC' AND date <= $date ORDER BY date DESC LIMIT 6
로직: (today.close - day5ago.close) / day5ago.close × 100
반환: number | null (데이터 부족 시 null)
```

**추가할 함수: `computeDivergenceSignal(todayScore, window252Scores, spx5dChange)`**
```
목적: 다이버전스 감지
로직:
  breadthScore5dChange = todayScore - score5dAgo  (window252Scores[-5])

  positive: spx5dChange < -1 AND breadthScore5dChange > +3
  negative: spx5dChange > +1 AND breadthScore5dChange < -3
  otherwise: null

반환: 'positive' | 'negative' | null
주의: window252Scores가 5개 미만이거나 spx5dChange가 null이면 null 반환
```

**`buildMarketBreadth` 함수 수정** (272행~):
- 스텝 7(Fear & Greed) 다음에 스텝 8로 삽입:
  ```
  // 8. BreadthScore + 다이버전스
  const window252 = await fetchWindow252(targetDate)
  const breadthScore = computeBreadthScore(currentData, window252)
  const spx5dChange = await fetchSpx5dChange(targetDate)
  const divergenceSignal = computeDivergenceSignal(breadthScore, window252.breadthScores, spx5dChange)
  ```
- upsert row 객체 (328행~)에 두 필드 추가:
  ```typescript
  breadthScore: String(breadthScore),
  divergenceSignal: divergenceSignal,
  ```
- onConflictDoUpdate set 블록 (356행~)에 두 항목 추가:
  ```typescript
  breadthScore: sql`EXCLUDED.breadth_score`,
  divergenceSignal: sql`EXCLUDED.divergence_signal`,
  ```
- logger.info 메시지에 `breadthScore=${breadthScore}` 추가

**의존성 주의**: `computeDivergenceSignal`은 `breadthScore`를 계산한 후에만 호출 가능. window252의 `breadthScores`는 직전 행들의 breadth_score 컬럼 값이므로, 매일 누적 실행 시 자연스럽게 채워진다. 백필 시는 날짜 오름차순으로 실행해야 한다.

### 파일 5: Repository (스냅샷 조회 쿼리)
`src/db/repositories/marketBreadthRepository.ts`

`findMarketBreadthSnapshot` 함수 (479행~): SELECT 목록에 두 컬럼 추가
```sql
breadth_score::text,
divergence_signal
```

`findMarketBreadthSnapshots` 함수 (517행~): 동일하게 두 컬럼 추가

### 파일 6: getMarketBreadth 툴 (daily 모드 응답)
`src/tools/getMarketBreadth.ts`

`executeDailyMode` 함수 (199행~) — 스냅샷 히트 분기 (204행~):
- `const breadthScore = snapshot.breadth_score != null ? toNum(snapshot.breadth_score) : null`
- `const divergenceSignal = snapshot.divergence_signal ?? null`
- 반환 JSON에 `breadthScore`, `divergenceSignal` 추가

`executeWeeklyMode` 함수 (23행~) — 스냅샷 완전 히트 분기 (41행~):
- `latestSnapshot` 객체에 `breadthScore`, `divergenceSignal` 추가
  (latestSnap에서 읽음)

### 파일 7: formatMarketSnapshot 포맷터
`src/debate/marketDataLoader.ts`

`MarketBreadthSnapshot` 인터페이스 (53행~):
```typescript
breadthScore: number | null;
divergenceSignal: 'positive' | 'negative' | null;
```

`loadMarketBreadth` 함수 (171행~) — 스냅샷 히트 분기 반환 객체 (183행~):
```typescript
breadthScore: snapshot.breadth_score != null ? toNum(snapshot.breadth_score) : null,
divergenceSignal: (snapshot.divergence_signal as 'positive' | 'negative' | null) ?? null,
```

폴백 분기 반환 객체 (234행~):
```typescript
breadthScore: null,
divergenceSignal: null,
```

`formatMarketSnapshot` 함수 (437행~) — 브레드스 섹션 (458행~):
현재:
```
- Phase 2 비율: ...
- 시장 평균 RS: ...
```
변경 후:
```
- Phase 2 비율: ...
- 시장 평균 RS: ...
- BreadthScore: ${b.breadthScore != null ? b.breadthScore.toFixed(1) : 'N/A'} / 100
  (다이버전스: ${b.divergenceSignal ?? '없음'})
```
divergenceSignal이 'positive'이면 "양봉 다이버전스(가격 하락 중 브레드스 개선)", 'negative'이면 "음봉 다이버전스(가격 상승 중 브레드스 악화)"로 한글 설명 추가.

## 작업 계획

### 단계 1: DB 스키마 (구현팀 — 완료 기준: 마이그레이션 실행 성공, 스키마 파일 반영)
1. `db/migrations/`에 SQL 마이그레이션 파일 작성
2. `src/db/schema/analyst.ts` — `marketBreadthDaily` 에 두 컬럼 추가
3. `src/db/repositories/types.ts` — `MarketBreadthDailyRow` 에 두 필드 추가

### 단계 2: ETL 계산 로직 (구현팀 — 단계 1 완료 후, 완료 기준: `yarn tsx build-market-breadth.ts` 성공 + breadth_score 컬럼에 값이 들어감)
1. `build-market-breadth.ts` 에 `fetchWindow252`, `computePercentileRank`, `computeBreadthScore`, `fetchSpx5dChange`, `computeDivergenceSignal` 함수 추가
2. `buildMarketBreadth` 함수에 스텝 8 삽입, upsert row 및 onConflictDoUpdate 수정

### 단계 3: Repository 쿼리 수정 (구현팀 — 단계 1과 병렬, 완료 기준: 스냅샷 조회 시 두 필드가 포함됨)
`findMarketBreadthSnapshot`, `findMarketBreadthSnapshots` SELECT 목록 수정

### 단계 4: 에이전트 노출 (구현팀 — 단계 2, 3 완료 후, 완료 기준: 툴 응답 JSON에 breadthScore/divergenceSignal 포함)
1. `getMarketBreadth.ts` — daily/weekly 모드 응답 수정
2. `marketDataLoader.ts` — `MarketBreadthSnapshot` 인터페이스 + `loadMarketBreadth` + `formatMarketSnapshot` 수정

### 단계 5: 테스트 (구현팀 — 단계 4 완료 후)
- `computePercentileRank` 단위 테스트: 빈 배열, null 포함 배열, 경계값
- `computeBreadthScore` 단위 테스트: fear_greed null/비null 두 케이스
- `computeDivergenceSignal` 단위 테스트: positive/negative/null 세 케이스
- `getMarketBreadth` 통합 테스트: 스냅샷 히트 시 두 필드 포함 여부

## 리스크

1. **252거래일 미충족 (124행 보유)**: 가용 데이터 내 퍼센타일로 진행. 초기 수십일은 모수가 작아 퍼센타일이 불안정할 수 있음. 허용 가능한 수준 — 데이터가 쌓이며 자연 안정화.

2. **백필 순서 의존성**: divergence_signal은 이전 행의 breadth_score를 참조함. 백필 스크립트 실행 시 반드시 날짜 오름차순으로 처리해야 함. 기존 `build-daily-ma.ts` 백필 패턴 참고.

3. **window252 쿼리 성능**: 매일 최대 252행 조회. 데이터량이 적어 큰 부담 없음. `market_breadth_daily.date` 컬럼에 이미 PK 인덱스 존재.

4. **fear_greed_score 공백**: CNN API는 가끔 실패함. null 처리 로직이 명세에 정의되어 있으므로 그대로 구현.

5. **폴백 분기 미지원**: `getMarketBreadth.ts`와 `marketDataLoader.ts`의 폴백(집계 쿼리) 분기는 breadthScore/divergenceSignal을 null로 반환. 이는 의도된 동작 — 스냅샷이 없는 날짜는 실시간 계산 불가.

## 의사결정 필요

없음 — 이슈 스펙이 모든 수식, 임계값, null 처리 방식을 확정하고 있으므로 바로 구현 가능.
