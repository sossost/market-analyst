import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { RecentRegime } from '../types'

vi.mock('../lib/supabase-queries', () => ({
  fetchRecentRegimes: vi.fn(),
}))

import { fetchRecentRegimes } from '../lib/supabase-queries'
import { MarketRegimeCard } from './MarketRegimeCard'

const mockFetchRecentRegimes = vi.mocked(fetchRecentRegimes)

function createRegime(overrides: Partial<RecentRegime> = {}): RecentRegime {
  return {
    regimeDate: '2026-03-11',
    regime: 'EARLY_BULL',
    rationale: 'Strong breadth with rising RS across multiple sectors',
    confidence: 'high',
    ...overrides,
  }
}

async function renderCard() {
  const ui = await MarketRegimeCard()
  return render(ui)
}

describe('MarketRegimeCard', () => {
  it('"시장 레짐" 타이틀 렌더링', async () => {
    mockFetchRecentRegimes.mockResolvedValue([])

    await renderCard()

    expect(screen.getByText('시장 레짐')).toBeInTheDocument()
  })

  it('regimes가 빈 배열이면 빈 상태 메시지 표시', async () => {
    mockFetchRecentRegimes.mockResolvedValue([])

    await renderCard()

    expect(screen.getByText('레짐 데이터가 없습니다')).toBeInTheDocument()
  })

  it('regimes가 빈 배열이면 "토론 보기" 링크 없음', async () => {
    mockFetchRecentRegimes.mockResolvedValue([])

    await renderCard()

    expect(screen.queryByText('토론 보기 →')).not.toBeInTheDocument()
  })

  it('fetch 실패 시 빈 상태 메시지 표시', async () => {
    mockFetchRecentRegimes.mockRejectedValue(new Error('DB 오류'))

    await renderCard()

    expect(screen.getByText('레짐 데이터가 없습니다')).toBeInTheDocument()
  })

  it('최신 레짐의 rationale 렌더링', async () => {
    const regime = createRegime({ rationale: 'Strong breadth' })
    mockFetchRecentRegimes.mockResolvedValue([regime])

    await renderCard()

    expect(screen.getByText('Strong breadth')).toBeInTheDocument()
  })

  it('"토론 보기" 링크가 최신 날짜로 연결', async () => {
    const regimes = [
      createRegime({ regimeDate: '2026-03-11' }),
      createRegime({ regimeDate: '2026-03-10', regime: 'MID_BULL' }),
    ]
    mockFetchRecentRegimes.mockResolvedValue(regimes)

    await renderCard()

    const link = screen.getByText('토론 보기 →')
    expect(link.closest('a')).toHaveAttribute('href', '/debates/2026-03-11')
  })

  it('타임라인에 레짐 날짜 렌더링', async () => {
    const regimes = [
      createRegime({ regimeDate: '2026-03-11' }),
      createRegime({ regimeDate: '2026-03-10', regime: 'MID_BULL' }),
    ]
    mockFetchRecentRegimes.mockResolvedValue(regimes)

    await renderCard()

    expect(screen.getByText('03-11')).toBeInTheDocument()
    expect(screen.getByText('03-10')).toBeInTheDocument()
  })
})
