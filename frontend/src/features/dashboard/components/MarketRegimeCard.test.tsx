import React from 'react'
import { render, screen } from '@testing-library/react'

import type { RecentRegime } from '../types'
import { MarketRegimeCard } from './MarketRegimeCard'

function createRegime(overrides: Partial<RecentRegime> = {}): RecentRegime {
  return {
    regimeDate: '2026-03-11',
    regime: 'EARLY_BULL',
    rationale: 'Strong breadth with rising RS across multiple sectors',
    confidence: 'high',
    ...overrides,
  }
}

describe('MarketRegimeCard', () => {
  it('"시장 레짐" 타이틀 렌더링', () => {
    render(<MarketRegimeCard regimes={[]} />)

    expect(screen.getByText('시장 레짐')).toBeInTheDocument()
  })

  it('regimes가 빈 배열이면 빈 상태 메시지 표시', () => {
    render(<MarketRegimeCard regimes={[]} />)

    expect(screen.getByText('레짐 데이터가 없습니다')).toBeInTheDocument()
  })

  it('regimes가 빈 배열이면 "토론 보기" 링크 없음', () => {
    render(<MarketRegimeCard regimes={[]} />)

    expect(screen.queryByText('토론 보기 →')).not.toBeInTheDocument()
  })

  it('최신 레짐의 rationale 렌더링', () => {
    const regime = createRegime({
      rationale: 'Strong breadth',
    })

    render(<MarketRegimeCard regimes={[regime]} />)

    expect(screen.getByText('Strong breadth')).toBeInTheDocument()
  })

  it('"토론 보기" 링크가 최신 날짜로 연결', () => {
    const regimes = [
      createRegime({ regimeDate: '2026-03-11' }),
      createRegime({ regimeDate: '2026-03-10', regime: 'MID_BULL' }),
    ]

    render(<MarketRegimeCard regimes={regimes} />)

    const link = screen.getByText('토론 보기 →')
    expect(link.closest('a')).toHaveAttribute('href', '/debates/2026-03-11')
  })

  it('타임라인에 레짐 날짜 렌더링', () => {
    const regimes = [
      createRegime({ regimeDate: '2026-03-11' }),
      createRegime({ regimeDate: '2026-03-10', regime: 'MID_BULL' }),
    ]

    render(<MarketRegimeCard regimes={regimes} />)

    expect(screen.getByText('03-11')).toBeInTheDocument()
    expect(screen.getByText('03-10')).toBeInTheDocument()
  })
})
