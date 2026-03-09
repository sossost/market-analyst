import { Badge } from '@/shared/components/ui/badge'

import type { MarketRegimeSummary } from '../types'

type RegimeType = MarketRegimeSummary['regime']

const REGIME_CONFIG: Record<
  RegimeType,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  EARLY_BULL: { label: 'Early Bull', variant: 'secondary' },
  MID_BULL: { label: 'Mid Bull', variant: 'secondary' },
  LATE_BULL: { label: 'Late Bull', variant: 'outline' },
  EARLY_BEAR: { label: 'Early Bear', variant: 'destructive' },
  BEAR: { label: 'Bear', variant: 'destructive' },
}

interface RegimeBadgeProps {
  regime: RegimeType
  confidence?: MarketRegimeSummary['confidence']
}

export function RegimeBadge({ regime, confidence }: RegimeBadgeProps) {
  const config = REGIME_CONFIG[regime]
  const confidenceLabel = confidence != null ? ` (${confidence})` : ''

  return (
    <Badge variant={config.variant}>
      {config.label}{confidenceLabel}
    </Badge>
  )
}
