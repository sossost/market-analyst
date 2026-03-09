import { Badge } from '@/shared/components/ui/badge'

import type { DebateThesis } from '../types'

type ThesisStatus = DebateThesis['status']

const STATUS_CONFIG: Record<
  ThesisStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  ACTIVE: { label: 'ACTIVE', variant: 'default' },
  CONFIRMED: { label: 'CONFIRMED', variant: 'secondary' },
  INVALIDATED: { label: 'INVALIDATED', variant: 'destructive' },
  EXPIRED: { label: 'EXPIRED', variant: 'outline' },
}

interface ThesisBadgeProps {
  status: ThesisStatus
}

export function ThesisBadge({ status }: ThesisBadgeProps) {
  const config = STATUS_CONFIG[status]

  return <Badge variant={config.variant}>{config.label}</Badge>
}
