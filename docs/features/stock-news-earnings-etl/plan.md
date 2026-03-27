# 종목 뉴스 & 실적 캘린더 ETL 파이프라인

## 선행 맥락

**news_archive 테이블 & collect-news.ts 기존 존재.**
현재 `news-archive` 피처(기존 spec.md)에서 Brave Search 기반 매크로 뉴스를 수집하고 있다.
- `news_archive` 테이블: url(UNIQUE), title, description, source, publishedAt, category, sentiment, queryPersona, queryText
- 수집 주기: KST 06:00 / 18:00 (2회/일), `com.market-analyst.news-collect.plist`
- 이 테이블에는 symbol 컬럼이 없다 — 종목 귀속 구조가 아님

**eps_surprises 테이블 & load-analyst-estimates.ts 기존 존재.**
- `eps_surprises` 테이블: (symbol, actual_date) UNIQUE, actual_eps, estimated_eps
- 현재 수집 방식: FMP `/stable/earnings-surprises-bulk?year=` (연도별 bulk) — recommendations 대상만
- `/stable/` 경로 사용 중이지만 이슈 #456 검증에서 `/api/v3/` 경로만 유효 확인됨
  → 신규 job에서는 `/api/v3/` 경로 사용. 기존 bulk 방식은 건드리지 않는다.

**earning_calendar 테이블 없음.** 신규 생성 필요.

## 골 정렬

**ALIGNED** — NDLS +55% 사례처럼 "왜 움직였는가" 설명 불가 상황을 직접 해소.
Phase 2 종목 + 관심종목의 촉매를 DB에서 즉시 조회할 수 있으면 기업 애널리스트(F10)와
토론 에이전트의 맥락 품질이 올라간다. 선행 포착 속도를 높이는 인프라다.

단, 뉴스 자체가 알파를 생성하는 것이 아니라 기존 분석의 "왜"를 채우는 보완재다.
SEPA, Phase, RS 판단 체계를 대체하지 않는다.

## 문제

종목 질문 시 정량 데이터(주가, RS, Phase)는 DB에 있지만 촉매(뉴스, 실적 서프라이즈)가 없어
"왜 움직였는가"를 설명하지 못한다. NDLS +55% 사례에서 news_archive 0건으로 웹서치에
의존했다. 실적 캘린더도 없어 임박한 이벤트 리스크를 사전에 파악할 수 없다.

## Before → After

**Before**
```
종목 뉴스: news_archive에 symbol 없음 — 종목별 조회 불가
실적 서프라이즈: load-analyst-estimates.ts가 recommendations 대상, /stable/ bulk
실적 캘린더: 테이블 없음 — 실적 발표 일정 데이터 부재
```

**After**
```
종목 뉴스: load-stock-news.ts — Phase 2 + 관심종목 대상 FMP /api/v3/stock_news
           → stock_news 테이블 (symbol 포함, news_archive와 별도)
실적 서프라이즈: load-earnings-surprises.ts — Phase 2 + 관심종목 대상 /api/v3/earnings-surprises
                → 기존 eps_surprises 테이블 재활용
실적 캘린더: load-earning-calendar.ts — /api/v3/earning_calendar 전체 범위 1회 조회
             → earning_calendar 테이블 (신규)
```

## 변경 사항

### 1. DB 스키마 — stock_news 테이블 신규 생성

news_archive는 symbol이 없는 매크로 뉴스 아카이브다. 종목 뉴스는 별도 테이블로 분리한다.

```typescript
// src/db/schema/analyst.ts 추가
export const stockNews = pgTable(
  "stock_news",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    publishedDate: text("published_date").notNull(), // YYYY-MM-DD HH:MM:SS (FMP 원본)
    title: text("title").notNull(),
    text: text("text"),           // 본문 요약
    image: text("image"),         // 썸네일 URL
    site: text("site"),           // 소스 도메인 (예: reuters.com)
    url: text("url").notNull(),   // 원본 기사 URL
    collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqUrl: unique("uq_stock_news_url").on(t.url),
    idxSymbol: index("idx_stock_news_symbol").on(t.symbol),
    idxPublishedDate: index("idx_stock_news_published_date").on(t.publishedDate),
  }),
);
```

### 2. DB 스키마 — earning_calendar 테이블 신규 생성

```typescript
// src/db/schema/analyst.ts 추가
export const earningCalendar = pgTable(
  "earning_calendar",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),              // 실적 발표일 (YYYY-MM-DD)
    eps: numeric("eps"),                       // 실제 EPS (발표 전 null)
    epsEstimated: numeric("eps_estimated"),
    revenue: numeric("revenue"),               // 실제 Revenue (발표 전 null)
    revenueEstimated: numeric("revenue_estimated"),
    time: text("time"),                        // 'amc' (After Market Close) | 'bmo' (Before Market Open)
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: unique("uq_earning_calendar_symbol_date").on(t.symbol, t.date),
    idxSymbol: index("idx_earning_calendar_symbol").on(t.symbol),
    idxDate: index("idx_earning_calendar_date").on(t.date),
  }),
);
```

### 3. ETL Job — src/etl/jobs/load-stock-news.ts (신규)

**대상 종목**: 오늘 기준 Phase 2 종목 + watchlist_stocks.status = 'ACTIVE'
- Phase 2 전체(~1400개)는 API 호출 비용 과다 → Phase 2 + (RS >= 70 OR vol_ratio >= 1.5) 조건으로 필터
- 관심종목(watchlist)은 무조건 포함 (현재 소수)
- 예상 대상: 200~400개 종목

**API**: `GET /api/v3/stock_news?tickers={symbol}&limit=5`
- 종목별 최신 5건, 동시 호출 CONCURRENCY=8, PAUSE_MS=100
- ON CONFLICT DO NOTHING (url UNIQUE)

**수집 기간 개념 없음**: FMP 응답이 최신 N건을 반환하므로 항상 최신 상태 유지

**보존 정책**: 90일 초과 데이터 삭제 (cleanup job 추가)
- 종목 뉴스는 뉴스 자체보다 촉매 설명용이므로 90일이면 충분

### 4. ETL Job — src/etl/jobs/load-earning-calendar.ts (신규)

**API**: `GET /api/v3/earning_calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
- 날짜 범위로 전체 조회 가능 — 종목별 호출 불필요
- 범위: 오늘 -7일 ~ +30일 (과거 실적 결과 업데이트 + 미래 일정)
- ON CONFLICT DO UPDATE (실제값이 채워지면 갱신)

**필터링**: 기존 Phase 2 + watchlist 종목에 해당하는 행만 upsert
- 전체 일정을 받아서 메모리에서 필터 후 저장 (DB 조회 1회)
- earning_calendar는 전 종목이 포함되어 있으나 관심 없는 종목은 저장 안 함

### 5. ETL Job — src/etl/jobs/load-earnings-surprises-fmp.ts (신규)

기존 `load-analyst-estimates.ts`의 eps_surprises 로직은 `/stable/` bulk 방식이다.
`/stable/` 경로는 빈 배열 반환 문제가 확인됐지만, 기존 job은 건드리지 않는다.
신규 job에서 `/api/v3/earnings-surprises/{symbol}` 개별 호출로 보완한다.

**대상**: Phase 2 + watchlist_stocks ACTIVE (뉴스와 동일 대상)
**API**: `GET /api/v3/earnings-surprises/{symbol}` → 최근 4분기
**저장**: 기존 eps_surprises 테이블 재활용 (ON CONFLICT DO UPDATE)

### 6. 스케줄 통합 — etl-daily.sh 편입

세 job 모두 etl-daily.sh Phase 3.8 직후에 추가한다.
stock_phases (Phase 2 종목) 완료 후 실행해야 대상 종목이 정확하다.

```
# Phase 3.9 (종목 촉매 데이터)
run_parallel \
  "Load Stock News" "src/etl/jobs/load-stock-news.ts" \
  "Load Earning Calendar" "src/etl/jobs/load-earning-calendar.ts" \
  "Load Earnings Surprises FMP" "src/etl/jobs/load-earnings-surprises-fmp.ts"
```

별도 launchd plist 불필요 — etl-daily.sh에 편입하는 것이 대상 종목 일관성을 보장한다.
(stock_phases 완료 후 즉시 실행하므로 "오늘의 Phase 2" 기준 일치)

### 7. package.json scripts 추가

```json
"etl:stock-news": "tsx src/etl/jobs/load-stock-news.ts",
"etl:earning-calendar": "tsx src/etl/jobs/load-earning-calendar.ts",
"etl:earnings-surprises-fmp": "tsx src/etl/jobs/load-earnings-surprises-fmp.ts"
```

## 작업 계획

### Step 1 — DB 스키마 & 마이그레이션 [구현팀]
- stock_news 테이블 추가 (analyst.ts)
- earning_calendar 테이블 추가 (analyst.ts)
- Drizzle 마이그레이션 생성 & 적용 (`yarn drizzle-kit generate && push`)
- 완료 기준: 두 테이블이 Supabase에 존재하고 Drizzle 타입이 export됨

### Step 2 — load-stock-news.ts [구현팀]
- getApiConfig() — DATA_API + FMP_API_KEY (validateEnvironmentVariables 패턴)
- fetchTargetSymbols() — stock_phases.phase=2 + RS/vol 조건 OR watchlist ACTIVE
- 종목별 FMP /api/v3/stock_news?tickers=&limit=5 호출
- pLimit(CONCURRENCY=8) + sleep(PAUSE_MS=100)
- ON CONFLICT DO NOTHING (url UNIQUE)
- 완료 기준: 단위 테스트 통과 + 로컬 실행 시 stock_news 적재 확인

### Step 3 — load-earning-calendar.ts [구현팀]
- 오늘 -7일 ~ +30일 범위 1회 호출
- Phase 2 + watchlist 심볼 SET 로드 → 필터
- ON CONFLICT DO UPDATE (eps, revenue 갱신)
- 완료 기준: 단위 테스트 통과 + 로컬 실행 시 earning_calendar 적재 확인

### Step 4 — load-earnings-surprises-fmp.ts [구현팀]
- 동일 대상 종목, /api/v3/earnings-surprises/{symbol} 개별 호출, 최근 4건
- 기존 eps_surprises 테이블 ON CONFLICT DO UPDATE
- 완료 기준: 단위 테스트 통과 + 기존 eps_surprises 데이터 갱신 확인

### Step 5 — etl-daily.sh 편입 + package.json [구현팀]
- Phase 3.8 직후 Phase 3.9 블록 추가 (병렬 실행)
- package.json 3개 스크립트 추가
- 완료 기준: ETL_SKIP_AGENT=1 ./scripts/cron/etl-daily.sh 로컬 실행 성공

### Step 6 — 코드 리뷰 [code-reviewer]
- CRITICAL/HIGH 이슈 수정 후 커밋

## 리스크

**1. FMP /api/v3/ stock_news 호출량**
Phase 2 종목 200~400개 × 1일 1회 = 400 API calls/일.
FMP Professional 플랜은 분당 300 calls 제한. CONCURRENCY=8 + PAUSE_MS=100이면
약 6~8분 소요. 허용 범위 내.

**2. news_archive vs stock_news 혼동**
두 테이블의 목적이 다르다:
- `news_archive`: 매크로 뉴스 (Brave Search, symbol 없음, 감성/카테고리 분류)
- `stock_news`: 종목 귀속 뉴스 (FMP, symbol 있음, 분류 없음)
감성/카테고리 분류는 stock_news에 추가하지 않는다 (FMP가 분류 제공 안 함, 룰 기반 분류기 정확도 한계).

**3. earnings-surprises 이중 수집**
기존 `load-analyst-estimates.ts`도 eps_surprises에 쓴다.
신규 job은 ON CONFLICT DO UPDATE로 덮어쓰므로 최신 데이터가 유지된다.
충돌 없음. 단, 두 job이 같은 날 실행되면 마지막 실행 결과가 남는다.

**4. earning_calendar 전종목 응답 크기**
`/api/v3/earning_calendar?from=...&to=...` 응답은 30일 기준 수천 건.
메모리에서 필터 후 관심 종목만 저장하므로 문제 없음.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 구현 시 확인 사항:
- `DATA_API` env가 `/stable`을 포함한 base URL인지, 아니면 bare base인지 확인 필요
  (기존 `getApiConfig()`에서 `${dataApi}/stable` 형태 사용 — 신규 job은 `/api/v3/` 경로이므로
  `${dataApi}/api/v3` 혹은 별도 base URL 변수 필요. load-index-prices.ts 패턴 참조.)
