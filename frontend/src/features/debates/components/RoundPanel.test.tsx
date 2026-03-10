import { render, screen } from '@testing-library/react'

import type { RoundOutput } from '../types'
import { RoundPanel } from './RoundPanel'

const MOCK_OUTPUTS: RoundOutput[] = [
  { persona: 'macro', content: '거시경제 관점에서의 분석' },
  { persona: 'tech', content: '기술적 분석 관점' },
]

describe('RoundPanel', () => {
  it('renders empty message when outputs is null', () => {
    render(<RoundPanel outputs={null} />)

    expect(
      screen.getByText('라운드 데이터가 없습니다'),
    ).toBeInTheDocument()
  })

  it('renders AnalystCard for each output', () => {
    render(<RoundPanel outputs={MOCK_OUTPUTS} />)

    expect(screen.getByText('거시경제')).toBeInTheDocument()
    expect(screen.getByText('기술분석')).toBeInTheDocument()
  })

  it('renders content from each output', () => {
    render(<RoundPanel outputs={MOCK_OUTPUTS} />)

    expect(
      screen.getByText('거시경제 관점에서의 분석'),
    ).toBeInTheDocument()
    expect(screen.getByText('기술적 분석 관점')).toBeInTheDocument()
  })

  it('renders empty list when outputs is an empty array', () => {
    const { container } = render(<RoundPanel outputs={[]} />)

    expect(
      screen.queryByText('라운드 데이터가 없습니다'),
    ).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0)
  })
})
