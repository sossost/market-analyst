import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

import type { StockProfile } from '../types'

const BILLION = 1_000_000_000
const MILLION = 1_000_000

function formatMarketCap(marketCap: number | null): string {
  if (marketCap == null) {
    return '-'
  }
  if (marketCap >= BILLION) {
    return `$${(marketCap / BILLION).toFixed(1)}B`
  }
  if (marketCap >= MILLION) {
    return `$${(marketCap / MILLION).toFixed(0)}M`
  }
  return `$${marketCap.toLocaleString()}`
}

interface BasicInfoCardProps {
  profile: StockProfile
}

export function BasicInfoCard({ profile }: BasicInfoCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-xl font-bold">{profile.symbol}</span>
          {profile.companyName !== '' && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {profile.companyName}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricItem label="섹터" value={profile.sector || '-'} />
          <MetricItem label="산업" value={profile.industry || '-'} />
          <MetricItem label="시가총액" value={formatMarketCap(profile.marketCap)} />
          {profile.priceDate != null && (
            <MetricItem label="기준일" value={profile.priceDate} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
