export default function StocksPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">종목 검색</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ticker 또는 종목명을 검색하여 Phase·RS·펀더멘탈을 확인하세요.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center py-16 text-center">
        <p className="text-base text-muted-foreground">
          위 검색창에 Ticker를 입력하거나
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          직접 URL로 이동하세요. 예:{' '}
          <span className="font-mono text-foreground">/stocks/AAPL</span>
        </p>
      </div>
    </main>
  )
}
