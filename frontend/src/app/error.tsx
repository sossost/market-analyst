'use client'

interface Props {
  error: Error
  reset: () => void
}

export default function ErrorPage({ error, reset }: Props) {
  return (
    <main className="p-6">
      <h1 className="text-destructive text-2xl font-bold">
        오류가 발생했습니다
      </h1>
      <p className="text-muted-foreground mt-2">
        {process.env.NODE_ENV === 'development'
          ? error.message
          : '예기치 않은 오류가 발생했습니다.'}
      </p>
      <button onClick={reset} className="mt-4 text-sm underline">
        다시 시도
      </button>
    </main>
  )
}
