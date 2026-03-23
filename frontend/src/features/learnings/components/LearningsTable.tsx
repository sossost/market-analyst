import { cn } from '@/shared/lib/utils'
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

import {
  CATEGORY_LABEL,
  ITEMS_PER_PAGE,
  VERIFICATION_PATH_LABEL,
  isActiveFilter,
  isLearningCategory,
} from '../constants'
import type { ActiveFilter } from '../constants'
import { fetchLearnings, fetchLearningSummary } from '../lib/supabase-queries'
import type { LearningCategory } from '../types'
import { LearningsSummaryCards } from './LearningsSummaryCards'

interface Props {
  searchParams: Promise<{ page?: string; filter?: string; category?: string }>
}

export async function LearningsTable({ searchParams }: Props) {
  const { page: pageParam, filter: filterParam, category: categoryParam } =
    await searchParams

  const currentPage = Math.max(1, Math.floor(Number(pageParam) || 1))
  const activeFilter: ActiveFilter = isActiveFilter(filterParam)
    ? filterParam
    : 'active'
  const categoryFilter: LearningCategory | undefined =
    isLearningCategory(categoryParam) ? categoryParam : undefined

  const [{ learnings, total }, summary] = await Promise.all([
    fetchLearnings(currentPage, activeFilter, categoryFilter),
    fetchLearningSummary(),
  ])

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const buildPageHref = (page: number) => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('filter', activeFilter)
    if (categoryFilter != null) {
      params.set('category', categoryFilter)
    }
    return `/learnings?${params.toString()}`
  }

  return (
    <>
      <LearningsSummaryCards summary={summary} />

      <div className="mt-4 flex gap-2">
        <CategoryBadgeFilter current={categoryFilter} activeFilter={activeFilter} />
      </div>

      {learnings.length === 0 ? (
        <div className="mt-6 rounded-lg border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            학습 원칙이 없습니다.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            시스템이 원칙을 학습하면 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">원칙</TableHead>
                  <TableHead>카테고리</TableHead>
                  <TableHead>Hit Rate</TableHead>
                  <TableHead>Hit / Miss</TableHead>
                  <TableHead>검증 경로</TableHead>
                  <TableHead>최근 검증</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learnings.map((learning) => (
                  <TableRow key={learning.id}>
                    <TableCell className="font-medium">
                      {learning.principle}
                      {!learning.isActive && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          비활성
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <CategoryBadge category={learning.category} />
                    </TableCell>
                    <TableCell>
                      <HitRateDisplay rate={learning.hitRate} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {learning.hitCount} / {learning.missCount}
                    </TableCell>
                    <TableCell>
                      {learning.verificationPath != null ? (
                        <span className="text-sm">
                          {VERIFICATION_PATH_LABEL[learning.verificationPath]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {learning.lastVerified != null ? (
                        <span className="text-sm">
                          {formatDate(learning.lastVerified)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="mt-8">
              <LearningsPagination
                currentPage={currentPage}
                totalPages={totalPages}
                buildPageHref={buildPageHref}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}

function CategoryBadge({ category }: { category: LearningCategory }) {
  const variant = category === 'confirmed' ? 'default' : 'secondary'
  return <Badge variant={variant}>{CATEGORY_LABEL[category]}</Badge>
}

function HitRateDisplay({ rate }: { rate: number | null }) {
  if (rate == null) {
    return <span className="text-muted-foreground">-</span>
  }

  const percent = rate * 100
  const color =
    percent >= 70
      ? 'text-green-600 dark:text-green-400'
      : percent >= 40
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-red-600 dark:text-red-400'

  return <span className={`text-sm font-medium ${color}`}>{percent.toFixed(1)}%</span>
}

function CategoryBadgeFilter({
  current,
  activeFilter,
}: {
  current: LearningCategory | undefined
  activeFilter: ActiveFilter
}) {
  const categories: { label: string; value: LearningCategory | undefined }[] = [
    { label: '전체', value: undefined },
    { label: CATEGORY_LABEL.confirmed, value: 'confirmed' },
    { label: CATEGORY_LABEL.caution, value: 'caution' },
  ]

  return (
    <>
      {categories.map(({ label, value }) => {
        const params = new URLSearchParams()
        params.set('filter', activeFilter)
        if (value != null) {
          params.set('category', value)
        }
        const href = `/learnings?${params.toString()}`
        const isSelected = current === value

        return (
          <a
            key={label}
            href={href}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </a>
        )
      })}
    </>
  )
}

const MAX_VISIBLE_PAGES = 5

function LearningsPagination({
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
