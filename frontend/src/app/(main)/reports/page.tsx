import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/components/ui/pagination'
import { ReportEmptyState } from '@/features/reports/components/ReportEmptyState'
import { ReportListItem } from '@/features/reports/components/ReportListItem'
import { ITEMS_PER_PAGE } from '@/features/reports/constants'
import { fetchReports } from '@/features/reports/lib/supabase-queries'
import type { ReportSummary } from '@/features/reports/types'

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function ReportsPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams
  const currentPage = Math.max(1, Number(pageParam) || 1)

  let reports: ReportSummary[] = []
  let total = 0
  let errorMessage: string | null = null

  try {
    const result = await fetchReports(currentPage)
    reports = result.reports
    total = result.total
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : '리포트 목록을 불러오는 중 오류가 발생했습니다.'
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">리포트</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        일간/주간 리포트 아카이브
      </p>

      {errorMessage != null && (
        <div className="mt-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {errorMessage}
          <p className="mt-1 text-xs">페이지를 새로고침하거나 잠시 후 다시 시도해주세요.</p>
        </div>
      )}

      {errorMessage == null && reports.length === 0 && <ReportEmptyState />}

      {reports.length > 0 && (
        <div className="mt-6 flex flex-col gap-4">
          {reports.map((report) => (
            <ReportListItem key={report.id} report={report} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8">
          <ReportPagination
            currentPage={currentPage}
            totalPages={totalPages}
          />
        </div>
      )}
    </main>
  )
}

function ReportPagination({
  currentPage,
  totalPages,
}: {
  currentPage: number
  totalPages: number
}) {
  const MAX_VISIBLE_PAGES = 5
  const halfVisible = Math.floor(MAX_VISIBLE_PAGES / 2)

  let startPage = Math.max(1, currentPage - halfVisible)
  const endPage = Math.min(totalPages, startPage + MAX_VISIBLE_PAGES - 1)

  if (endPage - startPage + 1 < MAX_VISIBLE_PAGES) {
    startPage = Math.max(1, endPage - MAX_VISIBLE_PAGES + 1)
  }

  const pages = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i,
  )

  return (
    <Pagination>
      <PaginationContent>
        {currentPage > 1 && (
          <PaginationItem>
            <PaginationPrevious
              href={`/reports?page=${currentPage - 1}`}
              text="이전"
            />
          </PaginationItem>
        )}

        {pages.map((page) => (
          <PaginationItem key={page}>
            <PaginationLink
              href={`/reports?page=${page}`}
              isActive={page === currentPage}
            >
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}

        {currentPage < totalPages && (
          <PaginationItem>
            <PaginationNext
              href={`/reports?page=${currentPage + 1}`}
              text="다음"
            />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  )
}
