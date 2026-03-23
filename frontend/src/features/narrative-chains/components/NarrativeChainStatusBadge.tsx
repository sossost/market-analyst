import { Badge } from '@/shared/components/ui/badge'

import { CHAIN_STATUS_LABEL, CHAIN_STATUS_VARIANT } from '../constants'
import type { NarrativeChainStatus } from '../types'

interface NarrativeChainStatusBadgeProps {
  status: NarrativeChainStatus
}

export function NarrativeChainStatusBadge({
  status,
}: NarrativeChainStatusBadgeProps) {
  return (
    <Badge variant={CHAIN_STATUS_VARIANT[status]}>
      {CHAIN_STATUS_LABEL[status]}
    </Badge>
  )
}
