import { Suspense } from 'react'

import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { CardError } from '@/features/dashboard/components/CardError'
import { LearningsTable } from '@/features/learnings/components/LearningsTable'
import { LearningsTableSkeleton } from '@/features/learnings/components/LearningsTableSkeleton'
import { LearningsCategoryFilter } from '@/features/learnings/components/LearningsCategoryFilter'

interface Props {
  searchParams: Promise<{ page?: string; filter?: string; category?: string }>
}

export default function LearningsPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">학습 루프 현황</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        시스템이 학습한 원칙들의 적중률과 검증 현황
      </p>
      <Suspense fallback={<div className="mt-4 h-9 w-48 rounded-lg bg-muted" />}>
        <LearningsCategoryFilter />
      </Suspense>
      <AsyncBoundary
        pendingFallback={<LearningsTableSkeleton />}
        errorFallback={<CardError title="학습 루프 현황" />}
      >
        <LearningsTable searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}
