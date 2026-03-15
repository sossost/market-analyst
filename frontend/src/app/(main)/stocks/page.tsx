import { StockSearchInput } from '@/features/stock-search/components/StockSearchInput'

export default function StocksPage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">종목 검색</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ticker 또는 종목명을 검색하여 Phase·RS·펀더멘탈을 확인하세요.
      </p>

      <div className="mt-6">
        <StockSearchInput />
      </div>

      <div className="mt-16 flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">
          검색창에 Ticker 또는 종목명을 입력하세요.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          예시: <span className="font-mono">AAPL</span>,{' '}
          <span className="font-mono">NVDA</span>,{' '}
          <span className="font-mono">Tesla</span>
        </p>
      </div>
    </main>
  )
}
