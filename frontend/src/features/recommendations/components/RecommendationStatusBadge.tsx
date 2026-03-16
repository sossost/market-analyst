import { Badge } from '@/shared/components/ui/badge'

import {
  RECOMMENDATION_STATUS_LABEL,
  RECOMMENDATION_STATUS_TOOLTIP,
} from '../constants'
import type { RecommendationStatus } from '../types'

interface RecommendationStatusBadgeProps {
  status: RecommendationStatus
}

const STATUS_VARIANT: Record<
  RecommendationStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  ACTIVE: 'default',
  CLOSED: 'secondary',
  CLOSED_PHASE_EXIT: 'outline',
  STOPPED: 'destructive',
}

export function RecommendationStatusBadge({
  status,
}: RecommendationStatusBadgeProps) {
  const label = RECOMMENDATION_STATUS_LABEL[status]
  const variant = STATUS_VARIANT[status]

  const tooltip = RECOMMENDATION_STATUS_TOOLTIP[status]

  return (
    <Badge variant={variant} title={tooltip}>
      {label}
    </Badge>
  )
}
