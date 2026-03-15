import { Skeleton } from '@/shared/components/ui/skeleton'

export function StockSearchSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* BasicInfoCard skeleton */}
      <div className="rounded-xl border p-4">
        <Skeleton className="mb-4 h-7 w-48" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      {/* TechnicalCard + RSCard skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4">
          <Skeleton className="mb-4 h-6 w-32" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <Skeleton className="mb-4 h-6 w-32" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>

      {/* FundamentalCard + SectorContext skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4">
          <Skeleton className="mb-4 h-6 w-36" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="rounded-xl border p-4">
          <Skeleton className="mb-4 h-6 w-36" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}
