import { cn } from '@/shared/lib/utils'

import type { RecommendationStatus } from '../types'

interface StatusSignalProps {
  entryPhase: number
  currentPhase: number | null
  status: RecommendationStatus
}

type SignalLevel = 'normal' | 'caution' | 'danger'

interface Signal {
  level: SignalLevel
  label: string
}

const SIGNAL_CONFIG: Record<
  SignalLevel,
  { dotClass: string; label: string; tooltip: string }
> = {
  normal: {
    dotClass: 'text-green-500',
    label: '정상 진행',
    tooltip: '추천 시점의 상승 흐름이 유지되고 있음',
  },
  caution: {
    dotClass: 'text-yellow-500',
    label: '둔화 주의',
    tooltip: '상승 흐름이 한 단계 하락 — 추이 모니터링 필요',
  },
  danger: {
    dotClass: 'text-red-500',
    label: '이탈 위험',
    tooltip: '상승 흐름에서 크게 이탈 — 매도 검토 필요',
  },
}

function computeSignal(
  entryPhase: number,
  currentPhase: number | null,
): Signal | null {
  if (currentPhase == null) {
    return null
  }

  const phaseDiff = currentPhase - entryPhase

  if (phaseDiff >= 0) {
    return { level: 'normal', label: SIGNAL_CONFIG.normal.label }
  }

  if (phaseDiff === -1) {
    return { level: 'caution', label: SIGNAL_CONFIG.caution.label }
  }

  return { level: 'danger', label: SIGNAL_CONFIG.danger.label }
}

export function StatusSignal({
  entryPhase,
  currentPhase,
  status,
}: StatusSignalProps) {
  if (status !== 'ACTIVE') {
    return null
  }

  const signal = computeSignal(entryPhase, currentPhase)

  if (signal == null) {
    return <span className="text-muted-foreground text-sm">—</span>
  }

  const config = SIGNAL_CONFIG[signal.level]

  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm cursor-help"
      title={config.tooltip}
    >
      <span
        className={cn('text-base leading-none', config.dotClass)}
        aria-hidden="true"
      >
        ●
      </span>
      <span>{signal.label}</span>
    </span>
  )
}
