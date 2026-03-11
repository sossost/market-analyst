import React from 'react'
import { render, screen } from '@testing-library/react'

import type { RecommendationStats, RecommendationSummary } from '../types'
import { RecommendationCard } from './RecommendationCard'

function createStats(
  overrides: Partial<RecommendationStats> = {},
): RecommendationStats {
  return {
    activeCount: 5,
    winRate: 60,
    avgPnlPercent: 8.5,
    maxPnlPercent: 35.2,
    avgDaysHeld: 12,
    topItems: [],
    ...overrides,
  }
}

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

describe('RecommendationCard', () => {
  it('"추천 성과 현황" 타이틀 렌더링', () => {
    render(<RecommendationCard stats={createStats({ activeCount: 0 })} />)

    expect(screen.getByText('추천 성과 현황')).toBeInTheDocument()
  })

  it('activeCount가 0이면 빈 상태 메시지 표시', () => {
    render(
      <RecommendationCard
        stats={createStats({ activeCount: 0, topItems: [] })}
      />,
    )

    expect(screen.getByText('활성 추천 종목이 없습니다')).toBeInTheDocument()
  })

  it('집계 수치 렌더링', () => {
    render(<RecommendationCard stats={createStats()} />)

    expect(screen.getByText('5종목')).toBeInTheDocument()
    expect(screen.getByText('60.0%')).toBeInTheDocument()
  })

  it('양수 평균 수익률에 + 접두어', () => {
    render(<RecommendationCard stats={createStats({ avgPnlPercent: 8.5 })} />)

    expect(screen.getByText('+8.50%')).toBeInTheDocument()
  })

  it('음수 평균 수익률에 - 접두어', () => {
    render(<RecommendationCard stats={createStats({ avgPnlPercent: -3.2 })} />)

    expect(screen.getByText('-3.20%')).toBeInTheDocument()
  })

  it('상위 종목 목록 렌더링', () => {
    const topItems = [
      createRecommendation({ id: 1, symbol: 'NVDA', pnlPercent: 35.5 }),
      createRecommendation({ id: 2, symbol: 'AAPL', pnlPercent: -5 }),
    ]

    render(<RecommendationCard stats={createStats({ topItems })} />)

    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('+35.50%')).toBeInTheDocument()
    expect(screen.getByText('-5.00%')).toBeInTheDocument()
  })

  it('pnlPercent가 null인 종목은 "-" 표시', () => {
    const topItems = [
      createRecommendation({ id: 1, symbol: 'XYZ', pnlPercent: null }),
    ]

    render(<RecommendationCard stats={createStats({ topItems })} />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
