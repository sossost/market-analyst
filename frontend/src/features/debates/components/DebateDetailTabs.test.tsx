import { render, screen } from '@testing-library/react'

import type { RoundOutput, DebateThesis, MarketRegimeSummary } from '../types'
import { DebateDetailTabs } from './DebateDetailTabs'

const MOCK_ROUND1: RoundOutput[] = [
  { persona: 'macro', content: 'Round 1 거시경제 분석' },
]

const MOCK_ROUND2: RoundOutput[] = [
  { persona: 'tech', content: 'Round 2 기술 분석' },
]

function createThesis(overrides: Partial<DebateThesis> = {}): DebateThesis {
  return {
    id: 1,
    agentPersona: 'macro',
    thesis: '테스트 전망',
    timeframeDays: 30,
    confidence: 'high',
    consensusLevel: '4/5',
    category: '통화정책',
    status: 'ACTIVE',
    nextBottleneck: null,
    dissentReason: null,
    ...overrides,
  }
}

describe('DebateDetailTabs', () => {
  it('renders all three tab triggers', () => {
    render(
      <DebateDetailTabs
        round1Outputs={MOCK_ROUND1}
        round2Outputs={MOCK_ROUND2}
        synthesisReport="종합 리포트"
        theses={[]}
        regime={null}
      />,
    )

    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByText('Round 2')).toBeInTheDocument()
    expect(screen.getByText('종합')).toBeInTheDocument()
  })

  it('renders synthesis content by default (defaultValue=2)', () => {
    render(
      <DebateDetailTabs
        round1Outputs={MOCK_ROUND1}
        round2Outputs={MOCK_ROUND2}
        synthesisReport="기본 종합 리포트 내용"
        theses={[createThesis()]}
        regime={null}
      />,
    )

    expect(screen.getByText('기본 종합 리포트 내용')).toBeInTheDocument()
  })

  it('disables Round 1 tab when round1Outputs is null', () => {
    render(
      <DebateDetailTabs
        round1Outputs={null}
        round2Outputs={MOCK_ROUND2}
        synthesisReport="리포트"
        theses={[]}
        regime={null}
      />,
    )

    const round1Tab = screen.getByText('Round 1')
    expect(round1Tab).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables Round 2 tab when round2Outputs is null', () => {
    render(
      <DebateDetailTabs
        round1Outputs={MOCK_ROUND1}
        round2Outputs={null}
        synthesisReport="리포트"
        theses={[]}
        regime={null}
      />,
    )

    const round2Tab = screen.getByText('Round 2')
    expect(round2Tab).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not disable tabs when outputs are provided', () => {
    render(
      <DebateDetailTabs
        round1Outputs={MOCK_ROUND1}
        round2Outputs={MOCK_ROUND2}
        synthesisReport="리포트"
        theses={[]}
        regime={null}
      />,
    )

    const round1Tab = screen.getByText('Round 1')
    const round2Tab = screen.getByText('Round 2')
    expect(round1Tab).not.toHaveAttribute('aria-disabled', 'true')
    expect(round2Tab).not.toHaveAttribute('aria-disabled', 'true')
  })
})
