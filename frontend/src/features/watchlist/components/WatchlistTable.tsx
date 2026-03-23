import Link from 'next/link'

import { PnlCell } from '@/features/recommendations/components/PnlCell'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/components/ui/pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatDate } from '@/shared/lib/formatDate'

import { ITEMS_PER_PAGE, isWatchlistStatus } from '../constants'
import { PHASE_LABEL } from '@/features/recommendations/constants'
import { fetchWatchlistStocks } from '../lib/supabase-queries'
import type { WatchlistStatus } from '../types'
import { WatchlistStatusBadge } from './WatchlistStatusBadge'

interface WatchlistTableProps {
  searchParams: Promise<{ page?: string; status?: string }>
}

export async function WatchlistTable({ searchParams }: WatchlistTableProps) {
  const { page: pageParam, status: statusParam } = await searchParams
  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))
  const DEFAULT_STATUS: WatchlistStatus = 'ACTIVE'
  const statusFilter: WatchlistStatus | undefined =
    statusParam === 'ALL'
      ? undefined
      : isWatchlistStatus(statusParam)
        ? statusParam
        : DEFAULT_STATUS

  const { stocks, total } = await fetchWatchlistStocks(
    currentPage,
    statusFilter,
  )
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (stocks.length === 0) {
    return (
      <div className="mt-6 rounded-lg border p-12 text-center">
        <p className="text-sm text-muted-foreground">
          관심종목이 없습니다.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          5중 교집합 게이트를 통과한 종목이 등록되면 여기에 표시됩니다.
        </p>
      </div>
    )
  }

  const buildPageHref = (page: number) => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    if (statusFilter != null) {
      params.set('status', statusFilter)
    }
    return `/watchlist?${params.toString()}`
  }

  return (
    <>
      <div className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>종목</TableHead>
              <TableHead>등록일</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>SEPA</TableHead>
              <TableHead>섹터 상대성과</TableHead>
              <TableHead>수익률</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stocks.map((stock) => (
              <TableRow key={stock.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/watchlist/${stock.id}`}
                    className="text-primary hover:underline"
                  >
                    {stock.symbol}
                  </Link>
                  {stock.entrySector != null && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {stock.entrySector}
                    </span>
                  )}
                </TableCell>
                <TableCell>{formatDate(stock.entryDate)}</TableCell>
                <TableCell>
                  <PhaseTransition
                    entryPhase={stock.entryPhase}
                    currentPhase={stock.currentPhase}
                  />
                </TableCell>
                <TableCell>
                  {stock.entrySepaGrade != null ? (
                    <span className="text-sm font-medium">
                      {stock.entrySepaGrade}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {stock.sectorRelativePerf != null ? (
                    <PnlCell value={stock.sectorRelativePerf} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <PnlCell value={stock.pnlPercent} />
                </TableCell>
                <TableCell>
                  <WatchlistStatusBadge status={stock.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="mt-8">
          <WatchlistPagination
            currentPage={currentPage}
            totalPages={totalPages}
            buildPageHref={buildPageHref}
          />
        </div>
      )}
    </>
  )
}

function PhaseTransition({
  entryPhase,
  currentPhase,
}: {
  entryPhase: number
  currentPhase: number | null
}) {
  const entryLabel = PHASE_LABEL[entryPhase] ?? `P${entryPhase}`
  if (currentPhase == null || currentPhase === entryPhase) {
    return <span className="text-sm">{entryLabel}</span>
  }

  const currentLabel = PHASE_LABEL[currentPhase] ?? `P${currentPhase}`
  const isImproved = currentPhase < entryPhase

  return (
    <span className="text-sm">
      {entryLabel}{' '}
      <span className={isImproved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
        → {currentLabel}
      </span>
    </span>
  )
}

const MAX_VISIBLE_PAGES = 5

function WatchlistPagination({
  currentPage,
  totalPages,
  buildPageHref,
}: {
  currentPage: number
  totalPages: number
  buildPageHref: (page: number) => string
}) {
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
              href={buildPageHref(currentPage - 1)}
              text="이전"
            />
          </PaginationItem>
        )}

        {pages.map((page) => (
          <PaginationItem key={page}>
            <PaginationLink
              href={buildPageHref(page)}
              isActive={page === currentPage}
            >
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}

        {currentPage < totalPages && (
          <PaginationItem>
            <PaginationNext
              href={buildPageHref(currentPage + 1)}
              text="다음"
            />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  )
}
