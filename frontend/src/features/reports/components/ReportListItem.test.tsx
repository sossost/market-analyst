import React from 'react'
import { render, screen } from '@testing-library/react'

import type { ReportSummary } from '../types'
import { ReportListItem } from './ReportListItem'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function createReport(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    id: 1,
    reportDate: '2026-03-09',
    type: 'daily',
    symbolCount: 5,
    leadingSectors: [],
    phase2Ratio: 42.5,
    ...overrides,
  }
}

describe('ReportListItem', () => {
  it('renders formatted date', () => {
    render(<ReportListItem report={createReport()} />)

    expect(screen.getByText('2026년 3월 9일')).toBeInTheDocument()
  })

  it('renders symbol count', () => {
    render(<ReportListItem report={createReport({ symbolCount: 5 })} />)

    expect(screen.getByText('5종목')).toBeInTheDocument()
  })

  it('renders phase2 ratio with one decimal', () => {
    render(<ReportListItem report={createReport({ phase2Ratio: 42.5 })} />)

    expect(screen.getByText('42.5%')).toBeInTheDocument()
  })

  it('renders "-" when leadingSectors is empty', () => {
    render(<ReportListItem report={createReport({ leadingSectors: [] })} />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders at most 3 sectors (MAX_VISIBLE_SECTORS)', () => {
    const sectors = ['Tech', 'Energy', 'Health', 'Finance']
    render(<ReportListItem report={createReport({ leadingSectors: sectors })} />)

    expect(screen.getByText('Tech')).toBeInTheDocument()
    expect(screen.getByText('Energy')).toBeInTheDocument()
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
  })

  it('links to the report detail page', () => {
    render(
      <ReportListItem report={createReport({ reportDate: '2026-03-09' })} />,
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/reports/2026-03-09')
  })
})
