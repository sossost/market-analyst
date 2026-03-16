'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { cn } from '@/shared/lib/utils'

import type { RecommendationStatus } from '../types'

type FilterOption = { label: string; value: RecommendationStatus | 'ALL' }

const FILTER_OPTIONS: FilterOption[] = [
  { label: '전체', value: 'ALL' },
  { label: '활성', value: 'ACTIVE' },
  { label: '종료', value: 'CLOSED' },
  { label: '중단', value: 'STOPPED' },
]

export function StatusFilterTabs() {
  const searchParams = useSearchParams()
  const currentStatus = searchParams.get('status') ?? 'ALL'

  return (
    <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1 w-fit">
      {FILTER_OPTIONS.map(({ label, value }) => {
        const href =
          value === 'ALL'
            ? '/recommendations'
            : `/recommendations?status=${value}`

        return (
          <Link
            key={value}
            href={href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              currentStatus === value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
