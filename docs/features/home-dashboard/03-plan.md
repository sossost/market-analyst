# Tasks: Home Dashboard

Estimated total: 8 tasks, Phase 2단계

## Phase 1: 데이터 레이어 + 카드 컴포넌트

목표: 4개 섹션의 데이터 쿼리와 카드 컴포넌트를 구현하여 홈페이지에 렌더링.

### Task 1: 타입 정의 + 쿼리 함수

**파일**: `features/dashboard/types.ts`, `features/dashboard/lib/supabase-queries.ts`

- 대시보드 전용 타입 정의:
  - `DashboardReport` — 최신 일간 리포트 요약
  - `ActiveThesis` — ACTIVE thesis (기존 `DebateThesis` 재활용 가능)
  - `RecommendationSummary` — 추천 종목 개별 행
  - `RecommendationStats` — 집계 (승률, 평균 수익률 등)
  - `RecentRegime` — 레짐 날짜별 행
- 4개 쿼리 함수 구현:
  - `fetchLatestDailyReport()` — daily_reports에서 최신 daily 1건
  - `fetchActiveTheses()` — theses에서 ACTIVE, confidence DESC, limit 10
  - `fetchActiveRecommendations()` — recommendations에서 ACTIVE 전체
  - `fetchRecentRegimes()` — market_regimes에서 최근 7건
- `calculateRecommendationStats()` — ACTIVE 목록으로 승률/평균 등 집계
- AC: 쿼리 함수 단위 테스트 (Supabase mock)

### Task 2: DailyReportCard 컴포넌트

**파일**: `features/dashboard/components/DailyReportCard.tsx`

- Card UI: 리포트 날짜, Phase 2 비율, 주도 섹터(Badge), 분석/추천 종목 수
- 빈 상태: 리포트 없을 때 메시지
- "상세 보기" Link -> `/reports/{date}`
- AC: 컴포넌트 테스트 (정상 렌더링, 빈 상태, 링크 존재)

### Task 3: ActiveThesesCard 컴포넌트

**파일**: `features/dashboard/components/ActiveThesesCard.tsx`

- Card UI: ACTIVE thesis 목록 (최대 10건)
  - thesis 본문, confidence, timeframe, persona, consensus_level
  - ThesisBadge 재활용 (debates 피처에서 import)
- 빈 상태: ACTIVE thesis 없을 때 메시지
- "전체 보기" Link -> `/debates`
- AC: 컴포넌트 테스트 (목록 렌더링, 빈 상태, 10건 초과 시 "더보기")

### Task 4: RecommendationCard 컴포넌트

**파일**: `features/dashboard/components/RecommendationCard.tsx`

- Card UI:
  - 집계 요약: 활성 종목 수, 승률, 평균 수익률, 최대 수익률, 평균 보유일
  - 상위 5개 종목 리스트 (symbol + pnl_percent, 색상 코딩)
- 빈 상태: ACTIVE 추천 없을 때 메시지
- MetricItem 공용 컴포넌트 분리
- AC: 컴포넌트 테스트 (집계 정확성, 색상 코딩, 빈 상태)

### Task 5: MarketRegimeCard 컴포넌트

**파일**: `features/dashboard/components/MarketRegimeCard.tsx`, `RegimeTimeline.tsx`

- Card UI:
  - 최신 레짐 배지 (RegimeBadge 재활용, debates에서 import)
  - confidence + rationale
  - 최근 7일 타임라인 (날짜 + RegimeBadge 수평 나열)
- 빈 상태: 레짐 데이터 없을 때 메시지
- "토론 보기" Link -> `/debates/{latest-date}`
- AC: 컴포넌트 테스트 (배지 렌더링, 타임라인 7일, 빈 상태)

### Task 6: 홈페이지 조립 + 스켈레톤

**파일**: `app/(main)/page.tsx`, `features/dashboard/components/DashboardSkeleton.tsx`

- Server Component에서 `Promise.allSettled`로 4개 쿼리 병렬 호출
- 2x2 반응형 그리드 레이아웃 (모바일 1열)
- 각 섹션 에러 시 fallback 메시지 (다른 섹션은 정상 표시)
- DashboardSkeleton: Suspense fallback용 스켈레톤
- barrel export (`features/dashboard/index.ts`)
- AC: 페이지 렌더링, 에러 격리 동작, 반응형 레이아웃

## Phase 2: 테스트 + 품질

### Task 7: 통합 테스트

- 쿼리 함수 테스트 (Supabase mock)
- 컴포넌트 테스트 전체 확인 (Task 2~5에서 작성한 테스트)
- 페이지 레벨 테스트 (데이터 주입 후 4개 섹션 렌더링 확인)
- AC: 커버리지 80% 이상

### Task 8: 코드 리뷰 + PR

- code-reviewer 에이전트 실행
- CRITICAL/HIGH 이슈 수정
- PR 생성 (pr-manager 위임)
- AC: 리뷰 통과, PR 생성 완료

## 의존성

```
Task 1 (타입 + 쿼리) -> Task 2, 3, 4, 5 (카드 컴포넌트, 병렬 가능)
Task 2, 3, 4, 5 -> Task 6 (페이지 조립)
Task 6 -> Task 7 (통합 테스트)
Task 7 -> Task 8 (코드 리뷰 + PR)
```

## 에이전트 배정

| Task | 에이전트 | 사유 |
|------|---------|------|
| Task 1 | 실행팀 (backend) | 쿼리 + 타입 |
| Task 2~5 | 실행팀 (frontend) | 컴포넌트 구현, 병렬 가능 |
| Task 6 | 실행팀 (frontend) | 페이지 조립 |
| Task 7 | 검증팀 (QA) | 테스트 |
| Task 8 | pr-manager | PR 생성 |

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| recommendations 테이블에 ACTIVE 데이터가 없을 수 있음 | 추천 성과 섹션이 항상 빈 상태 | 빈 상태 UI를 명확하게 구현. 데이터 없음 != 오류 |
| debates 피처의 RegimeBadge/ThesisBadge import 경로 변경 시 깨짐 | 빌드 실패 | barrel export 사용, 경로 변경 시 IDE 자동 감지 |
| Supabase 쿼리 권한 (RLS) 문제 | 데이터 조회 실패 | 기존 reports/debates 쿼리와 동일 패턴이므로 RLS 이슈 가능성 낮음 |
