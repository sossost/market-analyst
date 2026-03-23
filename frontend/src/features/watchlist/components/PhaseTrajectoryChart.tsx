'use client'

import { useMemo } from 'react'

import { PHASE_LABEL } from '@/features/recommendations/constants'

import type { PhaseTrajectoryPoint } from '../types'

interface PhaseTrajectoryChartProps {
  data: PhaseTrajectoryPoint[]
}

const CHART_WIDTH = 700
const CHART_HEIGHT = 200
const PADDING = { top: 20, right: 20, bottom: 40, left: 80 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

const MIN_PHASE = 1
const MAX_PHASE = 5

const PHASE_COLORS: Record<number, string> = {
  1: '#94a3b8', // slate-400
  2: '#22c55e', // green-500
  3: '#f59e0b', // amber-500
  4: '#f97316', // orange-500
  5: '#ef4444', // red-500
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split('-')
  const month = parts[1] ?? ''
  const day = parts[2] ?? ''
  return `${Number(month)}/${Number(day)}`
}

export function PhaseTrajectoryChart({ data }: PhaseTrajectoryChartProps) {
  const points = useMemo(() => {
    if (data.length === 0) return []

    return data.map((point, index) => {
      const x =
        data.length === 1
          ? INNER_WIDTH / 2
          : (index / (data.length - 1)) * INNER_WIDTH
      // Phase 1 = top, Phase 5 = bottom (inverted for visual clarity)
      const y =
        ((point.phase - MIN_PHASE) / (MAX_PHASE - MIN_PHASE)) * INNER_HEIGHT

      return { ...point, x, y }
    })
  }, [data])

  if (data.length === 0) {
    return null
  }

  // step-line path: horizontal then vertical
  const pathD = points
    .map((point, i) => {
      if (i === 0) return `M ${point.x} ${point.y}`
      const prev = points[i - 1]
      return `H ${point.x} V ${point.y}`
    })
    .join(' ')

  // Select ~6 evenly-spaced tick labels for the x-axis
  const TICK_COUNT = Math.min(6, data.length)
  const tickIndices = Array.from({ length: TICK_COUNT }, (_, i) =>
    Math.round((i / (TICK_COUNT - 1)) * (data.length - 1)),
  )

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full max-w-[700px]"
        role="img"
        aria-label="Phase 궤적 차트"
      >
        <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
          {/* Y-axis grid lines and labels */}
          {[1, 2, 3, 4, 5].map((phase) => {
            const y =
              ((phase - MIN_PHASE) / (MAX_PHASE - MIN_PHASE)) * INNER_HEIGHT
            return (
              <g key={phase}>
                <line
                  x1={0}
                  y1={y}
                  x2={INNER_WIDTH}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                />
                <text
                  x={-8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {PHASE_LABEL[phase] ?? `P${phase}`}
                </text>
              </g>
            )
          })}

          {/* Step line */}
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeOpacity={0.6}
            className="text-primary"
          />

          {/* Data points */}
          {points.map((point, i) => (
            <circle
              key={i}
              cx={point.x}
              cy={point.y}
              r={3}
              fill={PHASE_COLORS[point.phase] ?? '#94a3b8'}
              stroke="white"
              strokeWidth={1}
            >
              <title>
                {formatShortDate(point.date)} — {PHASE_LABEL[point.phase] ?? `Phase ${point.phase}`}
                {point.rsScore != null ? ` (RS: ${point.rsScore})` : ''}
              </title>
            </circle>
          ))}

          {/* X-axis tick labels */}
          {tickIndices.map((idx) => {
            const point = points[idx]
            if (point == null) return null
            return (
              <text
                key={idx}
                x={point.x}
                y={INNER_HEIGHT + 20}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {formatShortDate(point.date)}
              </text>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
