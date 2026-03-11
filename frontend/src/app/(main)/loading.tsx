import { CardSkeleton } from '@/features/dashboard/components/CardSkeleton'

export default function Loading() {
  return (
    <main className="p-6">
      <div className="mb-6 h-8 w-32 rounded bg-muted animate-pulse" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CardSkeleton title="오늘의 리포트" />
        <CardSkeleton title="시장 레짐" />
        <CardSkeleton title="Active Thesis" />
        <CardSkeleton title="추천 성과 현황" />
      </div>
    </main>
  )
}
