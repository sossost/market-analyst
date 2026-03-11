import { DashboardSkeleton } from '@/features/dashboard'

export default function Loading() {
  return (
    <main className="p-6">
      <div className="mb-6 h-8 w-32 rounded bg-muted animate-pulse" />
      <DashboardSkeleton />
    </main>
  )
}
