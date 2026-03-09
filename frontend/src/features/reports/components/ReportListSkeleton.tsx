import { Skeleton } from '@/shared/components/ui/skeleton'

const SKELETON_COUNT = 5

export function ReportListSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-4">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="rounded-lg border p-6">
          <Skeleton className="mb-4 h-6 w-48" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="col-span-2 h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
