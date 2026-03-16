import { Badge } from '@/shared/components/ui/badge'

import { RECOMMENDATION_STATUS_LABEL } from '../constants'
import type { RecommendationStatus } from '../types'

interface RecommendationStatusBadgeProps {
  status: RecommendationStatus
}

const STATUS_VARIANT: Record<
  RecommendationStatus,
  'default' | 'secondary' | 'destructive'
> = {
  ACTIVE: 'default',
  CLOSED: 'secondary',
  STOPPED: 'destructive',
}

export function RecommendationStatusBadge({
  status,
}: RecommendationStatusBadgeProps) {
  const label = RECOMMENDATION_STATUS_LABEL[status]
  const variant = STATUS_VARIANT[status]

  return <Badge variant={variant}>{label}</Badge>
}
