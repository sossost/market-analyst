import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/components/ui/pagination'
import { DebateEmptyState } from '@/features/debates/components/DebateEmptyState'
import { DebateListItem } from '@/features/debates/components/DebateListItem'
import { fetchDebateSessions } from '@/features/debates/lib/supabase-queries'

const ITEMS_PER_PAGE = 20

interface DebateListProps {
  searchParams: Promise<{ page?: string }>
}

export async function DebateList({ searchParams }: DebateListProps) {
  const { page: pageParam } = await searchParams
  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))

  const { sessions, total } = await fetchDebateSessions(currentPage)
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (sessions.length === 0) {
    return <DebateEmptyState />
  }

  return (
    <>
      <div className="mt-6 flex flex-col gap-4">
        {sessions.map((session) => (
          <DebateListItem key={session.id} session={session} />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="mt-8">
          <DebatePagination currentPage={currentPage} totalPages={totalPages} />
        </div>
      )}
    </>
  )
}

function DebatePagination({
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
              href={`/debates?page=${currentPage - 1}`}
              text="이전"
            />
          </PaginationItem>
        )}

        {pages.map((page) => (
          <PaginationItem key={page}>
            <PaginationLink
              href={`/debates?page=${page}`}
              isActive={page === currentPage}
            >
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}

        {currentPage < totalPages && (
          <PaginationItem>
            <PaginationNext
              href={`/debates?page=${currentPage + 1}`}
              text="다음"
            />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  )
}
