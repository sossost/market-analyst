import { Card, CardContent, CardHeader } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'

interface CardSkeletonProps {
  title?: string
}

export function CardSkeleton({ title }: CardSkeletonProps) {
  return (
    <Card>
      <CardHeader>
        {title != null ? (
          <span className="text-base font-semibold">{title}</span>
        ) : (
          <Skeleton className="h-5 w-32" />
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <Skeleton className="h-16" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </CardContent>
    </Card>
  )
}
