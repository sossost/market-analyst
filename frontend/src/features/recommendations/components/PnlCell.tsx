import { cn } from '@/shared/lib/utils'

interface PnlCellProps {
  value: number | null
}

export function PnlCell({ value }: PnlCellProps) {
  if (value == null) {
    return <span className="text-muted-foreground">-</span>
  }

  const isPositive = value > 0
  const isNegative = value < 0
  const formatted = `${isPositive ? '+' : ''}${value.toFixed(2)}%`

  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        isPositive && 'text-green-600 dark:text-green-400',
        isNegative && 'text-red-600 dark:text-red-400',
        !isPositive && !isNegative && 'text-muted-foreground',
      )}
    >
      {formatted}
    </span>
  )
}
