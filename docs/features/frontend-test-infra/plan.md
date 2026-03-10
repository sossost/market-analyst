# 프론트엔드 테스트 인프라 구축 (유닛 + E2E)

**이슈**: #132
**골 정렬**: SUPPORT — 간접 기여 (인프라/품질)

## Before → After

**Before**: 테스트 1개 (smoke), Playwright 미설치, 커버리지 0%
**After**: 테스트 138개+, 커버리지 99%+, E2E 크리티컬 플로우 커버

## Phase 1: 유닛 테스트 (완료)

### 1-A: Vitest 설정 보강
- `@vitest/coverage-v8` 설치
- coverage 설정 (v8, 80% threshold, features+shared/lib include)
- `fe:test`, `fe:test:watch`, `fe:test:coverage` 스크립트

### 1-B: 순수 로직 테스트 (P0)
- `formatDate.test.ts` — 날짜 포맷 변환
- `reports/constants.test.ts` — isReportType, isValidDateParam
- `debates/constants.test.ts` — getPersonaLabel
- `debates/lib/parse-round-outputs.test.ts` — JSON 파싱 + 유효성 검증

### 1-C: 쿼리 레이어 테스트 (P1)
- `reports/lib/supabase-queries.test.ts` — fetchReports, fetchReportByDate
- `debates/lib/supabase-queries.test.ts` — 4개 쿼리 함수
- Supabase 클라이언트 체이닝 모킹

### 1-D: 컴포넌트 테스트 (P2)
- reports: ReportTypeBadge, ReportListItem, MarketSummaryCard, RecommendedStockTable, ReportEmptyState, ReportListSkeleton
- debates: DebateListItem, RegimeBadge, AnalystCard, DebateDetailTabs, DebateEmptyState, DebateListSkeleton, RoundPanel, SynthesisPanel, ThesisBadge, ThesisList
- shared: env.ts

## Phase 2: E2E 테스트

### 2-A: Playwright 설치 및 설정
- `@playwright/test` 설치
- `playwright.config.ts` (chromium, firefox, webkit, mobile-chrome)
- `fe:e2e` 스크립트

### 2-B: E2E 크리티컬 플로우
- 리포트 플로우: 목록 → 상세
- 토론 플로우: 목록 → 상세 → 탭 전환
- 404 처리, 모바일 뷰포트

## 의사결정

1. **E2E 환경**: 로컬 기반 (CI 자동화는 별도 이슈)
2. **커버리지 범위**: `src/app/` 페이지 + auth + types 제외
