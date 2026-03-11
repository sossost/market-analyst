import React from 'react'
import { render, screen } from '@testing-library/react'

import type { ActiveThesis } from '../types'
import { ActiveThesesCard } from './ActiveThesesCard'

function createThesis(overrides: Partial<ActiveThesis> = {}): ActiveThesis {
  return {
    id: 1,
    agentPersona: 'macro',
    thesis: 'Tech sector will continue to outperform in Q2',
    timeframeDays: 30,
    confidence: 'high',
    consensusLevel: 'strong',
    category: 'sector',
    status: 'ACTIVE',
    nextBottleneck: 'Fed decision',
    dissentReason: null,
    ...overrides,
  }
}

describe('ActiveThesesCard', () => {
  it('"Active Thesis" 타이틀 렌더링', () => {
    render(<ActiveThesesCard theses={[]} totalCount={0} />)

    expect(screen.getByText('Active Thesis')).toBeInTheDocument()
  })

  it('theses가 빈 배열이면 빈 상태 메시지 표시', () => {
    render(<ActiveThesesCard theses={[]} totalCount={0} />)

    expect(screen.getByText('활성 thesis가 없습니다')).toBeInTheDocument()
  })

  it('thesis 목록 렌더링', () => {
    const theses = [
      createThesis({ id: 1, thesis: 'Tech outperform' }),
      createThesis({ id: 2, thesis: 'Energy sector rising', agentPersona: 'tech' }),
    ]

    render(<ActiveThesesCard theses={theses} totalCount={2} />)

    expect(screen.getByText('Tech outperform')).toBeInTheDocument()
    expect(screen.getByText('Energy sector rising')).toBeInTheDocument()
  })

  it('totalCount > theses.length일 때 "더보기" 메시지 표시', () => {
    const theses = [createThesis()]

    render(<ActiveThesesCard theses={theses} totalCount={15} />)

    expect(screen.getByText(/외 \d+건 더 있음/)).toBeInTheDocument()
  })

  it('totalCount === theses.length이면 "더보기" 메시지 없음', () => {
    const theses = [createThesis()]

    render(<ActiveThesesCard theses={theses} totalCount={1} />)

    expect(screen.queryByText(/외 \d+건 더 있음/)).not.toBeInTheDocument()
  })

  it('"전체 보기" 링크가 /debates로 연결', () => {
    render(<ActiveThesesCard theses={[]} totalCount={0} />)

    const link = screen.getByText('전체 보기 →')
    expect(link.closest('a')).toHaveAttribute('href', '/debates')
  })

  it('thesis의 기간, 합의 수준 렌더링', () => {
    render(
      <ActiveThesesCard
        theses={[createThesis({ timeframeDays: 30, consensusLevel: 'strong' })]}
        totalCount={1}
      />,
    )

    expect(screen.getByText('기간: 30일')).toBeInTheDocument()
    expect(screen.getByText('합의: strong')).toBeInTheDocument()
  })
})
