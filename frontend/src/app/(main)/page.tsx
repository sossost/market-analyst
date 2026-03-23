import { AsyncBoundary } from '@/shared/components/AsyncBoundary'
import { DailyReportCard } from '@/features/dashboard/components/DailyReportCard'
import { ActiveThesesCard } from '@/features/dashboard/components/ActiveThesesCard'
import { ThesisHitRateCard } from '@/features/dashboard/components/ThesisHitRateCard'
import { MarketRegimeCard } from '@/features/dashboard/components/MarketRegimeCard'
import { CardSkeleton } from '@/features/dashboard/components/CardSkeleton'
import { CardError } from '@/features/dashboard/components/CardError'

const DASHBOARD_SECTIONS = [
  { title: '오늘의 리포트', Component: DailyReportCard },
  { title: '시장 레짐', Component: MarketRegimeCard },
  { title: 'Active Thesis', Component: ActiveThesesCard },
  { title: 'Thesis KPI', Component: ThesisHitRateCard },
] as const

export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-bold">대시보드</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DASHBOARD_SECTIONS.map(({ title, Component }) => (
          <AsyncBoundary
            key={title}
            pendingFallback={<CardSkeleton title={title} />}
            errorFallback={<CardError title={title} />}
          >
            <Component />
          </AsyncBoundary>
        ))}
      </div>
    </main>
  )
}
