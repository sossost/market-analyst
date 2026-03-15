import { NextRequest, NextResponse } from 'next/server'

import { searchStockSymbolsServer } from '@/features/stock-search/lib/supabase-queries'

const MIN_QUERY_LENGTH = 1
const MAX_QUERY_LENGTH = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimit = new Map<string, RateLimitEntry>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimit.get(ip)

  if (entry == null || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: '요청 횟수가 너무 많습니다. 잠시 후 다시 시도하세요.' },
      { status: 429 },
    )
  }

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
