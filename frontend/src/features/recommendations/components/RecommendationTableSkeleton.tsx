import { Skeleton } from '@/shared/components/ui/skeleton'

// 실제 테이블 컬럼 수와 동기화. RecommendationTable 변경 시 함께 수정.
const TABLE_COLUMN_COUNT = 10
const SKELETON_ROW_COUNT = 10

export function RecommendationTableSkeleton() {
  return (
    <div className="mt-6">
      <div className="rounded-lg border">
        <div className="border-b p-3">
          <div className="grid grid-cols-10 gap-3">
            {Array.from({ length: TABLE_COLUMN_COUNT }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
          <div key={i} className="border-b p-3 last:border-b-0">
            <div className="grid grid-cols-10 gap-3">
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
