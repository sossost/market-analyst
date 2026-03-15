import Link from 'next/link'

interface StockNotFoundProps {
  symbol: string
}

export function StockNotFound({ symbol }: StockNotFoundProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-lg font-medium">
        종목을 찾을 수 없습니다
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-mono font-semibold">{symbol}</span>에 해당하는 종목 정보가 없습니다.
      </p>
      <Link
        href="/stocks"
        className="mt-4 text-sm text-primary hover:underline"
      >
        &larr; 검색으로 돌아가기
      </Link>
    </div>
  )
}
