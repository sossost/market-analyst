import { Suspense } from 'react'

import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { CardError } from '@/features/dashboard/components/CardError'
import { NarrativeChainTable } from '@/features/narrative-chains/components/NarrativeChainTable'
import { NarrativeChainTableSkeleton } from '@/features/narrative-chains/components/NarrativeChainTableSkeleton'
import { NarrativeChainStatusFilter } from '@/features/narrative-chains/components/NarrativeChainStatusFilter'

interface Props {
  searchParams: Promise<{ page?: string; status?: string }>
}

export default function NarrativeChainsPage({ searchParams }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">서사 체인</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        megatrend → demand driver → supply chain → bottleneck 흐름 추적
      </p>
      <Suspense fallback={<div className="mt-4 h-9 w-96 rounded-lg bg-muted" />}>
        <NarrativeChainStatusFilter />
      </Suspense>
      <AsyncBoundary
        pendingFallback={<NarrativeChainTableSkeleton />}
        errorFallback={<CardError title="서사 체인 목록" />}
      >
        <NarrativeChainTable searchParams={searchParams} />
      </AsyncBoundary>
    </main>
  )
}
