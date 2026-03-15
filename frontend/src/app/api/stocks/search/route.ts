import { NextRequest, NextResponse } from 'next/server'

import { searchStockSymbolsServer } from '@/features/stock-search/lib/supabase-queries'

const MIN_QUERY_LENGTH = 1
const MAX_QUERY_LENGTH = 20

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = searchParams.get('q') ?? ''

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [] })
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: '검색어가 너무 깁니다.' },
      { status: 400 },
    )
  }

  const results = await searchStockSymbolsServer(query)

  return NextResponse.json({ results })
}
