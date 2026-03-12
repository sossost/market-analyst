# 리스트 페이지 AsyncBoundary 패턴 적용

## 선행 맥락

PR #183에서 대시보드 홈(`app/(main)/page.tsx`)에 AsyncBoundary 패턴을 확립하고
`frontend/CONVENTIONS.md`에 공식 규칙으로 문서화했다. 해당 PR에서 리스트 페이지
2곳은 리팩토링 범위에서 제외되어 위반 상태가 잔존한다.

## 골 정렬

SUPPORT — 분석 품질 직접 기여는 아니나, 에러 핸들링 일관성 확보로 인프라/품질 개선.
패턴 위반 상태를 방치하면 향후 CONVENTIONS.md 준수 판단이 모호해진다.

## 문제

`app/(main)/reports/page.tsx`와 `app/(main)/debates/page.tsx` 두 파일이
CONVENTIONS.md에서 금지한 패턴을 사용 중이다:
- 페이지 컴포넌트에서 직접 `fetch` 실행 (페이지는 조립만 해야 함)
- `try-catch`로 에러를 삼키고 `errorMessage` 상태 변수로 인라인 처리
- ErrorBoundary가 에러를 잡지 못해 에러 상태가 일관되지 않음

## Before → After

### Before (위반 패턴)

```tsx
// app/(main)/reports/page.tsx
export default async function ReportsPage({ searchParams }: Props) {
  // fetch + try-catch를 페이지에서 직접 처리
  let reports: ReportSummary[] = []
  let total = 0
  let errorMessage: string | null = null

  try {
    const result = await fetchReports(currentPage)
    reports = result.reports
    total = result.total
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : '...'
  }

  return (
    <main>
      {errorMessage != null && <div className="...에러 인라인...">{errorMessage}</div>}
      {errorMessage == null && reports.length === 0 && <ReportEmptyState />}
      {reports.length > 0 && <div>...</div>}
      {totalPages > 1 && <ReportPagination ... />}
    </main>
  )
}
```

### After (목표 패턴 — 대시보드 홈과 동일 구조)

```tsx
// app/(main)/reports/page.tsx — 조립만, fetch 없음, async 제거
export default function ReportsPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">리포트</h1>
      <p className="mt-1 text-sm text-muted-foreground">일간/주간 리포트 아카이브</p>
      <AsyncBoundary
        pendingFallback={<ReportListSkeleton />}
        errorFallback={<CardError title="리포트 목록" />}
      >
        <ReportList searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}

// features/reports/components/ReportList.tsx — async Server Component
export async function ReportList({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams
  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))
  // fetch → throw on error (try-catch 없음)
  const { reports, total } = await fetchReports(currentPage)
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (reports.length === 0) return <ReportEmptyState />

  return (
    <>
      <div className="mt-6 flex flex-col gap-4">
        {reports.map((report) => <ReportListItem key={report.id} report={report} />)}
      </div>
      {totalPages > 1 && (
        <div className="mt-8">
          <ReportPagination currentPage={currentPage} totalPages={totalPages} />
        </div>
      )}
    </>
  )
}
```

## 수정 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/app/(main)/reports/page.tsx` | fetch 제거 → 조립 전용, async 제거, AsyncBoundary 추가 |
| `frontend/src/app/(main)/debates/page.tsx` | 동일 |

## 새로 생성할 파일

| 파일 | 내용 |
|------|------|
| `frontend/src/features/reports/components/ReportList.tsx` | async Server Component: fetch + 빈 상태 + 목록 + 페이지네이션 |
| `frontend/src/features/reports/components/ReportList.test.tsx` | 정상/빈 상태/에러 throw 3종 테스트 |
| `frontend/src/features/debates/components/DebateList.tsx` | async Server Component: fetch + 빈 상태 + 목록 + 페이지네이션 |
| `frontend/src/features/debates/components/DebateList.test.tsx` | 정상/빈 상태/에러 throw 3종 테스트 |

## 재사용 가능한 기존 컴포넌트

| 컴포넌트 | 위치 | 용도 |
|----------|------|------|
| `AsyncBoundary` | `shared/components/AsyncBoundary.tsx` | ErrorBoundary + Suspense 통합 |
| `CardError` | `features/dashboard/components/CardError.tsx` | 에러 폴백 UI (title prop 받음) |
| `ReportListSkeleton` | `features/reports/components/ReportListSkeleton.tsx` | 로딩 폴백 |
| `DebateListSkeleton` | `features/debates/components/DebateListSkeleton.tsx` | 로딩 폴백 |
| `ReportListItem` | `features/reports/components/ReportListItem.tsx` | 개별 리포트 카드 |
| `DebateListItem` | `features/debates/components/DebateListItem.tsx` | 개별 토론 카드 |
| `ReportEmptyState` | `features/reports/components/ReportEmptyState.tsx` | 빈 상태 UI |
| `DebateEmptyState` | `features/debates/components/DebateEmptyState.tsx` | 빈 상태 UI |
| `Pagination` 컴포넌트 | `shared/components/ui/pagination.tsx` | 페이지네이션 — 현재 인라인 함수로 존재, 별도 컴포넌트로 추출 |

## 페이지네이션 처리 방침

현재 `reports/page.tsx`와 `debates/page.tsx` 각각에 동일한 페이지네이션 로직이
인라인 함수(`ReportPagination`, `DebatePagination`)로 중복되어 있다.
두 컴포넌트는 href 경로만 다르고 로직이 동일하다.

이번 리팩토링에서 `ReportList.tsx` / `DebateList.tsx`로 각각 이전한다.
공통 추출(예: `ListPagination`)은 이 PR 범위 밖 — Rule of Three 미달.

## 작업 계획

### Phase 1 — Reports 리팩토링

**1-1. ReportList.tsx 생성**
- `features/reports/components/ReportList.tsx`
- async Server Component
- `fetchReports(currentPage)` 호출 (try-catch 없음 — throw 그대로)
- `reports.length === 0` 시 `<ReportEmptyState />` 반환
- 목록 + 페이지네이션 포함 (기존 `ReportPagination` 함수 이전)
- 완료 기준: `ReportList.test.tsx` 3종 테스트 통과

**1-2. reports/page.tsx 수정**
- async 제거, fetch 로직 제거
- `AsyncBoundary` + `ReportList` 조합으로 교체
- `pendingFallback={<ReportListSkeleton />}`, `errorFallback={<CardError title="리포트 목록" />}`
- 완료 기준: 페이지에 fetch 없음, try-catch 없음

### Phase 2 — Debates 리팩토링

**2-1. DebateList.tsx 생성**
- `features/debates/components/DebateList.tsx`
- 구조는 ReportList와 동일
- `fetchDebateSessions(currentPage)` 호출
- 완료 기준: `DebateList.test.tsx` 3종 테스트 통과

**2-2. debates/page.tsx 수정**
- async 제거, fetch 로직 제거
- `AsyncBoundary` + `DebateList` 조합으로 교체
- `pendingFallback={<DebateListSkeleton />}`, `errorFallback={<CardError title="토론 목록" />}`
- 완료 기준: 페이지에 fetch 없음, try-catch 없음

### Phase 3 — 검증

- `yarn fe:build` 빌드 통과 확인
- `yarn fe:lint` 린트 통과 확인
- 전체 테스트 (`yarn fe:test`) 통과 확인

## 리스크

- **없음**: 이번 변경은 동작 변경 없는 구조 리팩토링. 쿼리 함수, UI 컴포넌트, 데이터 흐름 변경 없음.
- **주의**: `searchParams`가 `Promise<...>` 타입이므로 ReportList/DebateList에서도 `await searchParams` 처리 필요. 현재 page.tsx와 동일한 방식 적용.
- **CardError 위치**: `features/dashboard/`에 위치하나 reports/debates에서 참조. 크로스-피처 import지만 현재 프로젝트 규모에서 shared/로 이동은 별도 이슈로 처리.

## 의사결정 필요

없음 — 바로 구현 가능
