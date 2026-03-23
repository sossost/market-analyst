import Link from 'next/link'

import { Badge } from '@/shared/components/ui/badge'
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

import { ITEMS_PER_PAGE, isNarrativeChainStatus } from '../constants'
import { fetchNarrativeChains } from '../lib/supabase-queries'
import type { NarrativeChainStatus, NarrativeChainSummary } from '../types'
import { NarrativeChainStatusBadge } from './NarrativeChainStatusBadge'

interface NarrativeChainTableProps {
  searchParams: Promise<{ page?: string; status?: string }>
}

export async function NarrativeChainTable({
  searchParams,
}: NarrativeChainTableProps) {
  const { page: pageParam, status: statusParam } = await searchParams
  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))

  let statusFilter: NarrativeChainStatus | undefined
  if (statusParam !== 'ALL' && isNarrativeChainStatus(statusParam)) {
    statusFilter = statusParam
  }

  const { chains, total } = await fetchNarrativeChains(
    currentPage,
    statusFilter,
  )
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  if (chains.length === 0) {
    return (
      <div className="mt-6 rounded-lg border p-12 text-center">
        <p className="text-sm text-muted-foreground">
          서사 체인이 없습니다.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          토론 엔진이 수요-공급-병목 서사를 도출하면 여기에 표시됩니다.
        </p>
      </div>
    )
  }

  const grouped = groupByMegatrend(chains)

  const buildPageHref = (page: number) => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    if (statusParam != null && statusParam !== '') {
      params.set('status', statusParam)
    }
    return `/narrative-chains?${params.toString()}`
  }

  return (
    <>
      <div className="mt-6 space-y-6">
        {grouped.map(({ megatrend, items }) => (
          <div key={megatrend}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
              {megatrend}
            </h3>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>병목</TableHead>
                    <TableHead>공급 체인</TableHead>
                    <TableHead>식별일</TableHead>
                    <TableHead>수혜</TableHead>
                    <TableHead>상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((chain) => (
                    <TableRow key={chain.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/narrative-chains/${chain.id}`}
                          className="text-primary hover:underline"
                        >
                          {chain.bottleneck}
                        </Link>
                        {chain.alphaCompatible === true && (
                          <span className="ml-1.5 text-xs text-green-600 dark:text-green-400">
                            Alpha
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {chain.supplyChain}
                      </TableCell>
                      <TableCell>
                        {formatDate(chain.bottleneckIdentifiedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {chain.beneficiarySectors.slice(0, 3).map((sector) => (
                            <Badge key={sector} variant="outline" className="text-xs">
                              {sector}
                            </Badge>
                          ))}
                          {chain.beneficiaryTickers.slice(0, 3).map((ticker) => (
                            <Badge key={ticker} variant="secondary" className="text-xs">
                              {ticker}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <NarrativeChainStatusBadge status={chain.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="mt-8">
          <NarrativeChainPagination
            currentPage={currentPage}
            totalPages={totalPages}
            buildPageHref={buildPageHref}
          />
        </div>
      )}
    </>
  )
}

interface MegatrendGroup {
  megatrend: string
  items: NarrativeChainSummary[]
}

function groupByMegatrend(chains: NarrativeChainSummary[]): MegatrendGroup[] {
  const map = new Map<string, NarrativeChainSummary[]>()

  for (const chain of chains) {
    const existing = map.get(chain.megatrend)
    if (existing != null) {
      existing.push(chain)
    } else {
      map.set(chain.megatrend, [chain])
    }
  }

  return Array.from(map.entries()).map(([megatrend, items]) => ({
    megatrend,
    items,
  }))
}

const MAX_VISIBLE_PAGES = 5

function NarrativeChainPagination({
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
