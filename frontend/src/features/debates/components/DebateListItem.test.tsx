import React from 'react'
import { render, screen } from '@testing-library/react'

import type { DebateSessionSummary } from '../types'
import { DebateListItem } from './DebateListItem'

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

function createSession(
  overrides: Partial<DebateSessionSummary> = {},
): DebateSessionSummary {
  return {
    id: 1,
    date: '2026-03-09',
    vix: '18.5',
    fearGreedScore: '65',
    phase2Ratio: '42.5',
    topSectorRs: null,
    thesesCount: 3,
    ...overrides,
  }
}

describe('DebateListItem', () => {
  it('renders formatted date', () => {
    render(<DebateListItem session={createSession()} />)

    expect(screen.getByText('2026년 3월 9일')).toBeInTheDocument()
  })

  it('renders VIX value', () => {
    render(<DebateListItem session={createSession({ vix: '18.5' })} />)

    expect(screen.getByText('18.5')).toBeInTheDocument()
  })

  it('renders "-" when VIX is null', () => {
    render(<DebateListItem session={createSession({ vix: null })} />)

    const vixLabel = screen.getByText('VIX')
    const vixValue = vixLabel.closest('div')?.querySelector('.text-sm')

    expect(vixValue).toHaveTextContent('-')
  })

  it('renders Fear & Greed score', () => {
    render(
      <DebateListItem session={createSession({ fearGreedScore: '65' })} />,
    )

    expect(screen.getByText('65')).toBeInTheDocument()
  })

  it('renders "-" when Fear & Greed is null', () => {
    render(
      <DebateListItem session={createSession({ fearGreedScore: null })} />,
    )

    const label = screen.getByText('Fear & Greed')
    const value = label.closest('div')?.querySelector('.text-sm')

    expect(value).toHaveTextContent('-')
  })

  it('renders phase2 ratio with percent sign', () => {
    render(
      <DebateListItem session={createSession({ phase2Ratio: '42.5' })} />,
    )

    expect(screen.getByText('42.5%')).toBeInTheDocument()
  })

  it('renders "-" when phase2Ratio is null', () => {
    render(
      <DebateListItem session={createSession({ phase2Ratio: null })} />,
    )

    const label = screen.getByText('Phase 2 비율')
    const value = label.closest('div')?.querySelector('.text-sm')

    expect(value).toHaveTextContent('-')
  })

  it('renders thesis count', () => {
    render(<DebateListItem session={createSession({ thesesCount: 3 })} />)

    expect(screen.getByText('3건')).toBeInTheDocument()
  })

  it('does not render topSectorRs area when null', () => {
    render(<DebateListItem session={createSession({ topSectorRs: null })} />)

    expect(
      screen.queryByText('Technology, Energy'),
    ).not.toBeInTheDocument()
  })

  it('renders topSectorRs text when present', () => {
    render(
      <DebateListItem
        session={createSession({ topSectorRs: 'Technology, Energy' })}
      />,
    )

    expect(screen.getByText('Technology, Energy')).toBeInTheDocument()
  })

  it('links to the debate detail page', () => {
    render(<DebateListItem session={createSession({ date: '2026-03-09' })} />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/debates/2026-03-09')
  })
})
