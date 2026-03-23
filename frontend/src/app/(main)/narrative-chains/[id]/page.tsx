import Link from 'next/link'

import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { CardError } from '@/features/dashboard/components/CardError'
import { NarrativeChainDetailView } from '@/features/narrative-chains/components/NarrativeChainDetailView'
import { NarrativeChainTableSkeleton } from '@/features/narrative-chains/components/NarrativeChainTableSkeleton'

interface Props {
  params: Promise<{ id: string }>
}

export default async function NarrativeChainDetailPage({ params }: Props) {
  const { id: idParam } = await params
  const id = Number(idParam)

  if (Number.isNaN(id) || id <= 0) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">
          유효하지 않은 서사 체인 ID입니다.
        </p>
        <Link
          href="/narrative-chains"
          className="mt-2 text-sm text-primary hover:underline"
        >
          목록으로 돌아가기
        </Link>
      </main>
    )
  }

  return (
    <main className="p-6">
      <Link
        href="/narrative-chains"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← 서사 체인 목록
      </Link>
      <div className="mt-4">
        <AsyncBoundary
          pendingFallback={<NarrativeChainTableSkeleton />}
          errorFallback={<CardError title="서사 체인 상세" />}
        >
          <NarrativeChainDetailView id={id} />
        </AsyncBoundary>
      </div>
    </main>
  )
}
