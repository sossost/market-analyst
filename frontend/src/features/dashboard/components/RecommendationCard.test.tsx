import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { RecommendationStats, RecommendationSummary } from '../types'

vi.mock('../lib/supabase-queries', () => ({
  fetchActiveRecommendations: vi.fn(),
  calculateRecommendationStats: vi.fn(),
}))

import {
  fetchActiveRecommendations,
  calculateRecommendationStats,
} from '../lib/supabase-queries'
import { RecommendationCard } from './RecommendationCard'

const mockFetchActiveRecommendations = vi.mocked(fetchActiveRecommendations)
const mockCalculateRecommendationStats = vi.mocked(calculateRecommendationStats)

function createRecommendation(
  overrides: Partial<RecommendationSummary> = {},
): RecommendationSummary {
  return {
    id: 1,
    symbol: 'AAPL',
    sector: 'Technology',
    pnlPercent: 10,
    maxPnlPercent: 15,
    daysHeld: 10,
    currentPhase: 2,
    ...overrides,
  }
}

function emptyStats(): RecommendationStats {
  return {
    activeCount: 0,
    winRate: 0,
    avgPnlPercent: 0,
    maxPnlPercent: 0,
    avgDaysHeld: 0,
    topItems: [],
  }
}

async function renderCard() {
  const ui = await RecommendationCard()
  return render(ui)
}

describe('RecommendationCard', () => {
  it('"추천 성과 현황" 타이틀 렌더링', async () => {
    mockFetchActiveRecommendations.mockResolvedValue([])
    mockCalculateRecommendationStats.mockReturnValue(emptyStats())

    await renderCard()

    expect(screen.getByText('추천 성과 현황')).toBeInTheDocument()
  })

  it('추천 종목이 없으면 빈 상태 메시지 표시', async () => {
    mockFetchActiveRecommendations.mockResolvedValue([])
    mockCalculateRecommendationStats.mockReturnValue(emptyStats())

    await renderCard()

    expect(screen.getByText('활성 추천 종목이 없습니다')).toBeInTheDocument()
  })

  it('fetch 실패 시 에러가 throw되어 ErrorBoundary로 전파됨', async () => {
    mockFetchActiveRecommendations.mockRejectedValue(new Error('DB 오류'))

    await expect(RecommendationCard()).rejects.toThrow('DB 오류')
  })

  it('집계 수치 렌더링', async () => {
    mockFetchActiveRecommendations.mockResolvedValue([createRecommendation()])
    mockCalculateRecommendationStats.mockReturnValue({
      activeCount: 5,
      winRate: 60,
      avgPnlPercent: 8.5,
      avgDaysHeld: 12,
      topItems: [],
    })

    await renderCard()

    expect(screen.getByText('5종목')).toBeInTheDocument()
    expect(screen.getByText('60.0%')).toBeInTheDocument()
  })

  it('양수 평균 수익률에 + 접두어', async () => {
    mockFetchActiveRecommendations.mockResolvedValue([createRecommendation()])
    mockCalculateRecommendationStats.mockReturnValue({
      activeCount: 1,
      winRate: 100,
      avgPnlPercent: 8.5,
      avgDaysHeld: 10,
      topItems: [],
    })

    await renderCard()

    expect(screen.getByText('+8.50%')).toBeInTheDocument()
  })

  it('음수 평균 수익률에 - 접두어', async () => {
    mockFetchActiveRecommendations.mockResolvedValue([createRecommendation()])
    mockCalculateRecommendationStats.mockReturnValue({
      activeCount: 1,
      winRate: 0,
      avgPnlPercent: -3.2,
      avgDaysHeld: 10,
      topItems: [],
    })

    await renderCard()

    expect(screen.getByText('-3.20%')).toBeInTheDocument()
  })

  it('상위 종목 목록 렌더링', async () => {
    const topItems = [
      createRecommendation({ id: 1, symbol: 'NVDA', pnlPercent: 35.5 }),
      createRecommendation({ id: 2, symbol: 'AAPL', pnlPercent: -5 }),
    ]
    mockFetchActiveRecommendations.mockResolvedValue(topItems)
    mockCalculateRecommendationStats.mockReturnValue({
      activeCount: 2,
      winRate: 50,
      avgPnlPercent: 15.25,
      avgDaysHeld: 10,
      topItems,
    })

    await renderCard()

    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('+35.50%')).toBeInTheDocument()
    expect(screen.getByText('-5.00%')).toBeInTheDocument()
  })

  it('pnlPercent가 null인 종목은 "-" 표시', async () => {
    const topItems = [
      createRecommendation({ id: 1, symbol: 'XYZ', pnlPercent: null }),
    ]
    mockFetchActiveRecommendations.mockResolvedValue(topItems)
    mockCalculateRecommendationStats.mockReturnValue({
      activeCount: 1,
      winRate: 0,
      avgPnlPercent: 0,
      avgDaysHeld: 10,
      topItems,
    })

    await renderCard()

    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
