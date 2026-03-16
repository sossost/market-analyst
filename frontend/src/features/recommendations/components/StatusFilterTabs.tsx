'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { cn } from '@/shared/lib/utils'

type FilterValue = 'ALL' | 'ACTIVE' | 'CLOSED' | 'STOPPED'

type FilterOption = { label: string; value: FilterValue }

const FILTER_OPTIONS: FilterOption[] = [
  { label: '활성 중', value: 'ACTIVE' },
  { label: '종료됨', value: 'CLOSED' },
  { label: '전체', value: 'ALL' },
]

export function StatusFilterTabs() {
  const searchParams = useSearchParams()
  const currentStatus = searchParams.get('status') ?? 'ACTIVE'

  return (
    <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1 w-fit">
      {FILTER_OPTIONS.map(({ label, value }) => {
        const href = `/recommendations?status=${value}`

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
