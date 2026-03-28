# Plan: 기업 애널리스트 뉴스/실적 컨텍스트 주입

**이슈**: #459
**트랙**: Lite
**난이도**: Low

## 배경

#456에서 stock_news, earning_calendar ETL이 추가되어 데이터가 축적 중.
현재 기업 애널리스트 프롬프트에는 주입되지 않아 활용되지 못함.

> eps_surprises는 이미 `<forward_estimates>` 태그에서 analyst_estimates와 함께 주입 중이므로 **범위 제외**.

## 작업 범위

| 데이터 | 테이블 | 주입 방식 | 조건 |
|--------|--------|-----------|------|
| 최근 뉴스 | stock_news | title + site + published_date (최근 5건) | text 본문 제외 (토큰 절약) |
| 실적 일정 | earning_calendar | date + epsEstimated + revenueEstimated + time | 30일 이내 |

**토큰 증가 예상**: ~190토큰 (전체 프롬프트 대비 2~3%). 비용 영향 무시 가능.

## 변경 파일

### 1. Repository 함수 추가

**새 함수 2개:**

```typescript
// 최근 뉴스 5건 조회
findStockNews(symbol: string, limit: number, pool: Pool): Promise<StockNewsRow[]>
// SELECT title, site, published_date FROM stock_news
// WHERE symbol = $1 ORDER BY published_date DESC LIMIT $2

// 30일 이내 실적 일정 조회
findUpcomingEarnings(symbol: string, baseDate: string, pool: Pool): Promise<EarningCalendarRow[]>
// SELECT date, eps_estimated, revenue_estimated, time FROM earning_calendar
// WHERE symbol = $1 AND date BETWEEN $2 AND ($2 + 30 days) ORDER BY date ASC
```

`src/db/repositories/index.ts`에 re-export 추가.

### 2. `src/corporate-analyst/loadAnalysisInputs.ts`

- Row 타입 2개 추가: `StockNewsRow`, `EarningCalendarRow`
- `AnalysisInputs` 인터페이스에 필드 2개 추가:
  - `recentNews: Array<{ title: string; site: string; publishedDate: string }> | null`
  - `upcomingEarnings: Array<{ date: string; epsEstimated: number | null; revenueEstimated: number | null; time: string | null }> | null`
- `Promise.all`에 쿼리 2개 추가 (14 → 16개)
- 결과 매핑 로직 추가

### 3. `src/corporate-analyst/corporateAnalyst.ts`

- `buildUserPrompt()`에 XML 태그 2개 추가:
  - `<recent_news>` — 뉴스 제목 리스트
  - `<upcoming_earnings>` — 실적 발표 일정
- `SYSTEM_PROMPT`에 활용 지침 추가:
  - recent_news → 투자 요약과 리스크 분석에 최근 촉매/이벤트 반영
  - upcoming_earnings → 리스크 요인에 실적 발표 임박 사실 명시

### 4. 테스트

- repository 함수 단위 테스트
- loadAnalysisInputs 새 필드 통합 테스트
- buildUserPrompt XML 태그 생성 테스트

## 구현 순서

1. Repository 함수 생성 + export
2. loadAnalysisInputs 확장 (타입 + 쿼리 + 매핑)
3. buildUserPrompt XML 태그 + SYSTEM_PROMPT 지침 추가
4. 테스트 작성
5. 코드 리뷰
