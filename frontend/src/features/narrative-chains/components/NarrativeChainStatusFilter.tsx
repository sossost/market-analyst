'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { cn } from '@/shared/lib/utils'

type FilterValue = 'ALL' | 'ACTIVE' | 'RESOLVING' | 'RESOLVED' | 'OVERSUPPLY' | 'INVALIDATED'

type FilterOption = { label: string; value: FilterValue }

const FILTER_OPTIONS: FilterOption[] = [
  { label: '활성', value: 'ACTIVE' },
  { label: '해소 중', value: 'RESOLVING' },
  { label: '해소됨', value: 'RESOLVED' },
  { label: '공급 과잉', value: 'OVERSUPPLY' },
  { label: '무효', value: 'INVALIDATED' },
  { label: '전체', value: 'ALL' },
]

export function NarrativeChainStatusFilter() {
  const searchParams = useSearchParams()
  const currentStatus = searchParams.get('status') ?? 'ALL'

  return (
    <div className="mt-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1 w-fit">
      {FILTER_OPTIONS.map(({ label, value }) => {
        const href = `/narrative-chains?status=${value}`

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
