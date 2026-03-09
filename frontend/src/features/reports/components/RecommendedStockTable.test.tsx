import React from 'react'
import { render, screen } from '@testing-library/react'

import type { ReportedStock } from '../types'

import { RecommendedStockTable } from './RecommendedStockTable'

const createStock = (overrides: Partial<ReportedStock> = {}): ReportedStock => ({
  symbol: 'AAPL',
  phase: 2,
  prevPhase: 1,
  rsScore: 85.3,
  sector: 'Technology',
  industry: 'Consumer Electronics',
  reason: 'Strong momentum',
  firstReportedDate: '2026-03-01',
  ...overrides,
})

describe('RecommendedStockTable', () => {
  it('renders empty message when stocks array is empty', () => {
    render(<RecommendedStockTable stocks={[]} />)

    expect(screen.getByText('추천 종목이 없습니다')).toBeInTheDocument()
  })

  it('renders table headers', () => {
    render(<RecommendedStockTable stocks={[createStock()]} />)

    expect(screen.getByText('종목코드')).toBeInTheDocument()
    expect(screen.getByText('Phase')).toBeInTheDocument()
    expect(screen.getByText('이전 Phase')).toBeInTheDocument()
    expect(screen.getByText('RS 점수')).toBeInTheDocument()
    expect(screen.getByText('섹터')).toBeInTheDocument()
    expect(screen.getByText('산업')).toBeInTheDocument()
    expect(screen.getByText('최초 보고일')).toBeInTheDocument()
  })

  it('renders stock data correctly', () => {
    const stock = createStock({
      symbol: 'TSLA',
      phase: 2,
      prevPhase: 1,
      rsScore: 92.5,
      sector: 'Automotive',
      industry: 'EV',
      firstReportedDate: '2026-03-05',
    })

    render(<RecommendedStockTable stocks={[stock]} />)

    expect(screen.getByText('TSLA')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('92.5')).toBeInTheDocument()
    expect(screen.getByText('Automotive')).toBeInTheDocument()
    expect(screen.getByText('EV')).toBeInTheDocument()
    expect(screen.getByText('2026-03-05')).toBeInTheDocument()
  })

  it('renders dash when prevPhase is null', () => {
    const stock = createStock({ prevPhase: null })

    render(<RecommendedStockTable stocks={[stock]} />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('sorts stocks by rsScore descending', () => {
    const stocks = [
      createStock({ symbol: 'LOW', rsScore: 50.0 }),
      createStock({ symbol: 'HIGH', rsScore: 95.0 }),
      createStock({ symbol: 'MID', rsScore: 75.0 }),
    ]

    render(<RecommendedStockTable stocks={stocks} />)

    const cells = screen.getAllByRole('row').slice(1) // skip header
    const symbols = cells.map(
      (row) => row.querySelector('td')?.textContent,
    )

    expect(symbols).toEqual(['HIGH', 'MID', 'LOW'])
  })
})
