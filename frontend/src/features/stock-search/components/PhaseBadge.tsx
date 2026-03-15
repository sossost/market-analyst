import { Badge } from '@/shared/components/ui/badge'

import type { StockPhase } from '../types'

const PHASE_LABELS: Record<StockPhase, string> = {
  1: 'Phase 1',
  2: 'Phase 2',
  3: 'Phase 3',
  4: 'Phase 4',
}

// Phase 2 초입 포착이 핵심 골 — 색상으로 강조
const PHASE_CLASS_MAP: Record<StockPhase, string> = {
  1: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  2: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  3: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  4: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}

interface PhaseBadgeProps {
  phase: StockPhase | null
  className?: string
}

export function PhaseBadge({ phase, className }: PhaseBadgeProps) {
  if (phase == null) {
    return (
      <Badge variant="outline" className={className}>
        Phase -
      </Badge>
    )
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PHASE_CLASS_MAP[phase]} ${className ?? ''}`}
    >
      {PHASE_LABELS[phase]}
    </span>
  )
}
