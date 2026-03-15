import React from 'react'

export function formatRs(value: number | null): string {
  if (value == null) {
    return '-'
  }
  return value.toFixed(1)
}

export function formatPct(value: number | null): string {
  if (value == null) {
    return '-'
  }
  return `${value.toFixed(1)}%`
}

export function formatChangeArrow(change: number | null): React.ReactNode {
  if (change == null) {
    return <span className="text-muted-foreground">-</span>
  }
  const isPositive = change >= 0
  const arrow = isPositive ? '▲' : '▼'
  const cls = isPositive
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400'
  return (
    <span className={`text-xs font-semibold ${cls}`}>
      {arrow} {Math.abs(change).toFixed(1)}
    </span>
  )
}

export function formatRank(rank: number | null, total: number | null): string {
  if (rank == null || total == null) {
    return '-'
  }
  return `${rank} / ${total}`
}

export function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
