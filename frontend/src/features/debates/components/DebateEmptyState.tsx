export function DebateEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-lg font-medium text-muted-foreground">
        토론 기록이 없습니다
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        토론이 진행되면 이곳에 표시됩니다.
      </p>
    </div>
  )
}
