import { Badge } from '@/shared/components/ui/badge'

import { WATCHLIST_STATUS_LABEL, WATCHLIST_STATUS_TOOLTIP } from '../constants'
import type { WatchlistStatus } from '../types'

interface WatchlistStatusBadgeProps {
  status: WatchlistStatus
}

const STATUS_VARIANT: Record<WatchlistStatus, 'default' | 'secondary'> = {
  ACTIVE: 'default',
  EXITED: 'secondary',
}

export function WatchlistStatusBadge({ status }: WatchlistStatusBadgeProps) {
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      title={WATCHLIST_STATUS_TOOLTIP[status]}
    >
      {WATCHLIST_STATUS_LABEL[status]}
    </Badge>
  )
}
