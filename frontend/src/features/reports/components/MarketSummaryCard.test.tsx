import React from 'react'
import { render, screen } from '@testing-library/react'

import type { MarketSummary } from '../types'
import { MarketSummaryCard } from './MarketSummaryCard'

function createSummary(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    phase2Ratio: 35.2,
    totalAnalyzed: 500,
    leadingSectors: [],
    ...overrides,
  }
}

describe('MarketSummaryCard', () => {
  it('renders "시장 요약" title', () => {
    render(<MarketSummaryCard summary={createSummary()} />)

    expect(screen.getByText('시장 요약')).toBeInTheDocument()
  })

  it('renders phase2 ratio with one decimal', () => {
    render(
      <MarketSummaryCard summary={createSummary({ phase2Ratio: 35.2 })} />,
    )

    expect(screen.getByText('35.2%')).toBeInTheDocument()
  })

  it('renders total analyzed count', () => {
    render(
      <MarketSummaryCard summary={createSummary({ totalAnalyzed: 500 })} />,
    )

    expect(screen.getByText('500종목')).toBeInTheDocument()
  })

  it('renders "-" when leadingSectors is empty', () => {
    render(
      <MarketSummaryCard summary={createSummary({ leadingSectors: [] })} />,
    )

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders sector badges', () => {
    render(
      <MarketSummaryCard
        summary={createSummary({ leadingSectors: ['Tech', 'Energy'] })}
      />,
    )

    expect(screen.getByText('Tech')).toBeInTheDocument()
    expect(screen.getByText('Energy')).toBeInTheDocument()
  })
})
