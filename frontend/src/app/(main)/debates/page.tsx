import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { DebateList } from '@/features/debates/components/DebateList'
import { DebateListSkeleton } from '@/features/debates/components/DebateListSkeleton'
import { CardError } from '@/features/dashboard/components/CardError'

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default function DebatesPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">토론</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        애널리스트 토론 세션 아카이브
      </p>
      <AsyncBoundary
        pendingFallback={<DebateListSkeleton />}
        errorFallback={<CardError title="토론 목록" />}
      >
        <DebateList searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}
