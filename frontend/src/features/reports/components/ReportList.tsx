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

interface ReportListProps {
  searchParams: Promise<{ page?: string }>
}

export async function ReportList({ searchParams }: ReportListProps) {
  const { page: pageParam } = await searchParams
  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))

  const { reports, total } = await fetchReports(currentPage)
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (reports.length === 0) {
    return <ReportEmptyState />
  }

  return (
    <>
      <div className="mt-6 flex flex-col gap-4">
        {reports.map((report) => (
          <ReportListItem key={report.id} report={report} />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="mt-8">
          <ReportPagination currentPage={currentPage} totalPages={totalPages} />
        </div>
      )}
    </>
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
