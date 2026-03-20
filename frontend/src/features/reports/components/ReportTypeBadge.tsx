import { Badge } from '@/shared/components/ui/badge'

import { REPORT_TYPE_LABEL } from '../constants'
import type { ReportType } from '../types'

interface ReportTypeBadgeProps {
  type: ReportType
}

export function ReportTypeBadge({ type }: ReportTypeBadgeProps) {
  const label = REPORT_TYPE_LABEL[type]
  const variant = type === 'daily' ? 'secondary' : type === 'debate' ? 'outline' : 'default'

  return <Badge variant={variant}>{label}</Badge>
}
