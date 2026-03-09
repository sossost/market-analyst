interface Props {
  params: Promise<{ date: string }>
}

export default async function DebateDetailPage({ params }: Props) {
  const { date } = await params
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">토론 상세</h1>
      <p className="text-muted-foreground mt-2">
        {date} 토론이 여기에 표시됩니다.
      </p>
    </main>
  )
}
