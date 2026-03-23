'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { cn } from '@/shared/lib/utils'

import { ACTIVE_FILTER_LABEL, type ActiveFilter } from '../constants'

const FILTER_OPTIONS: { label: string; value: ActiveFilter }[] = [
  { label: ACTIVE_FILTER_LABEL.active, value: 'active' },
  { label: ACTIVE_FILTER_LABEL.inactive, value: 'inactive' },
  { label: ACTIVE_FILTER_LABEL.all, value: 'all' },
]

export function LearningsCategoryFilter() {
  const searchParams = useSearchParams()
  const currentFilter = searchParams.get('filter') ?? 'active'

  return (
    <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1 w-fit">
      {FILTER_OPTIONS.map(({ label, value }) => {
        const params = new URLSearchParams()
        params.set('filter', value)
        const category = searchParams.get('category')
        if (category != null) {
          params.set('category', category)
        }
        const href = `/learnings?${params.toString()}`

        return (
          <Link
            key={value}
            href={href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              currentFilter === value
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
