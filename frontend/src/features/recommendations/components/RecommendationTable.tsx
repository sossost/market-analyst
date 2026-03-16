import Link from 'next/link'

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

import { ITEMS_PER_PAGE, isRecommendationStatus } from '../constants'
import { fetchRecommendations } from '../lib/supabase-queries'
import type { RecommendationStatus } from '../types'
import { PnlCell } from './PnlCell'
import { RecommendationStatusBadge } from './RecommendationStatusBadge'

interface RecommendationTableProps {
  searchParams: Promise<{ page?: string; status?: string }>
}

export async function RecommendationTable({
  searchParams,
}: RecommendationTableProps) {
  const { page: pageParam, status: statusParam } = await searchParams
  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))
  const statusFilter: RecommendationStatus | undefined = isRecommendationStatus(
    statusParam,
  )
    ? statusParam
    : undefined

  const { recommendations, total } = await fetchRecommendations(
    currentPage,
    statusFilter,
  )
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (recommendations.length === 0) {
    return (
      <div className="mt-6 rounded-lg border p-12 text-center">
        <p className="text-sm text-muted-foreground">추천 종목이 없습니다.</p>
      </div>
    )
  }

  const buildPageHref = (page: number) => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    if (statusFilter != null) {
      params.set('status', statusFilter)
    }
    return `/recommendations?${params.toString()}`
  }

  return (
    <>
      <div className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>종목</TableHead>
              <TableHead>추천일</TableHead>
              <TableHead>진입가</TableHead>
              <TableHead>Phase 전환</TableHead>
              <TableHead>RS</TableHead>
              <TableHead>현재가</TableHead>
              <TableHead>수익률</TableHead>
              <TableHead>최대수익률</TableHead>
              <TableHead>보유일</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recommendations.map((rec) => (
              <TableRow key={rec.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/recommendations/${rec.id}`}
                    className="text-primary hover:underline"
                  >
                    {rec.symbol}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(rec.recommendationDate)}</TableCell>
                <TableCell className="tabular-nums">
                  ${rec.entryPrice.toFixed(2)}
                </TableCell>
                <TableCell>
                  {rec.entryPrevPhase != null
                    ? `${rec.entryPrevPhase}→${rec.entryPhase}`
                    : `Phase ${rec.entryPhase}`}
                </TableCell>
                <TableCell className="tabular-nums">
                  {rec.entryRsScore ?? '-'}
                </TableCell>
                <TableCell className="tabular-nums">
                  {rec.currentPrice != null
                    ? `$${rec.currentPrice.toFixed(2)}`
                    : '-'}
                </TableCell>
                <TableCell>
                  <PnlCell value={rec.pnlPercent} />
                </TableCell>
                <TableCell>
                  <PnlCell value={rec.maxPnlPercent} />
                </TableCell>
                <TableCell className="tabular-nums">{rec.daysHeld}일</TableCell>
                <TableCell>
                  <RecommendationStatusBadge status={rec.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="mt-8">
          <RecommendationPagination
            currentPage={currentPage}
            totalPages={totalPages}
            buildPageHref={buildPageHref}
          />
        </div>
      )}
    </>
  )
}

const MAX_VISIBLE_PAGES = 5

function RecommendationPagination({
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
