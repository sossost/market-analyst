interface MetricItemProps {
  label: string
  value: string
}

export function MetricItem({ label, value }: MetricItemProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
