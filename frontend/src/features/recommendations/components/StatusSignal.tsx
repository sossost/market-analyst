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
    label: '상승 유지',
    tooltip: '상승 구간(Phase 2)이 유지되고 있음',
  },
  caution: {
    dotClass: 'text-yellow-500',
    label: '고점 접근',
    tooltip: '고점 형성 구간(Phase 3) 진입 — 추이 모니터링 필요',
  },
  danger: {
    dotClass: 'text-red-500',
    label: '하락 전환',
    tooltip: '상승 구간을 이탈하여 하락 전환 — 매도 검토 필요',
  },
}

/**
 * 현재 Phase 기준으로 상태 신호 산출.
 * Phase 2(상승 초입)에서 진입하므로:
 * - Phase 2 유지: 정상 (상승 지속)
 * - Phase 3 진입: 주의 (고점 형성 — 상승 에너지 감소)
 * - Phase 4/5/1 진입: 위험 (하락 전환)
 */
function computeSignal(
  _entryPhase: number,
  currentPhase: number | null,
): Signal | null {
  if (currentPhase == null) {
    return null
  }

  if (currentPhase === 2) {
    return { level: 'normal', label: SIGNAL_CONFIG.normal.label }
  }

  if (currentPhase === 3) {
    return { level: 'caution', label: SIGNAL_CONFIG.caution.label }
  }

  // Phase 1, 4, 5 — 상승 구간 이탈
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
