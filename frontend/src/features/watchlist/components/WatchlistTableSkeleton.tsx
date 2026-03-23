import { Skeleton } from '@/shared/components/ui/skeleton'

const TABLE_COLUMN_COUNT = 7
const SKELETON_ROW_COUNT = 10

export function WatchlistTableSkeleton() {
  return (
    <div className="mt-6">
      <div className="rounded-lg border">
        <div className="border-b p-3">
          <div className="grid grid-cols-7 gap-3">
            {Array.from({ length: TABLE_COLUMN_COUNT }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
          <div key={i} className="border-b p-3 last:border-b-0">
            <div className="grid grid-cols-7 gap-3">
              {Array.from({ length: TABLE_COLUMN_COUNT }, (_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
