import { render, screen } from '@testing-library/react'

import type { DebateThesis } from '../types'
import { ThesisList } from './ThesisList'

function createThesis(overrides: Partial<DebateThesis> = {}): DebateThesis {
  return {
    id: 1,
    agentPersona: 'macro',
    thesis: '금리 인하 사이클 시작 예상',
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

describe('ThesisList', () => {
  it('renders empty message when theses is empty', () => {
    render(<ThesisList theses={[]} />)

    expect(
      screen.getByText('생성된 thesis가 없습니다'),
    ).toBeInTheDocument()
  })

  it('renders thesis text', () => {
    render(<ThesisList theses={[createThesis()]} />)

    expect(
      screen.getByText('금리 인하 사이클 시작 예상'),
    ).toBeInTheDocument()
  })

  it('renders persona label', () => {
    render(
      <ThesisList theses={[createThesis({ agentPersona: 'macro' })]} />,
    )

    expect(screen.getByText('거시경제')).toBeInTheDocument()
  })

  it('renders status badge', () => {
    render(
      <ThesisList theses={[createThesis({ status: 'CONFIRMED' })]} />,
    )

    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
  })

  it('renders category badge', () => {
    render(
      <ThesisList theses={[createThesis({ category: '통화정책' })]} />,
    )

    expect(screen.getByText('통화정책')).toBeInTheDocument()
  })

  it('renders timeframe, confidence, and consensus', () => {
    render(
      <ThesisList
        theses={[
          createThesis({
            timeframeDays: 30,
            confidence: 'high',
            consensusLevel: '4/5',
          }),
        ]}
      />,
    )

    expect(screen.getByText('기간: 30일')).toBeInTheDocument()
    expect(screen.getByText('신뢰도: high')).toBeInTheDocument()
    expect(screen.getByText('합의: 4/5')).toBeInTheDocument()
  })

  it('renders nextBottleneck when present', () => {
    render(
      <ThesisList
        theses={[createThesis({ nextBottleneck: 'CPI 발표 대기' })]}
      />,
    )

    expect(screen.getByText('CPI 발표 대기')).toBeInTheDocument()
    expect(screen.getByText('다음 병목:')).toBeInTheDocument()
  })

  it('does not render nextBottleneck when null', () => {
    render(
      <ThesisList theses={[createThesis({ nextBottleneck: null })]} />,
    )

    expect(screen.queryByText('다음 병목:')).not.toBeInTheDocument()
  })

  it('renders dissentReason when present', () => {
    render(
      <ThesisList
        theses={[createThesis({ dissentReason: '인플레이션 재발 우려' })]}
      />,
    )

    expect(screen.getByText('인플레이션 재발 우려')).toBeInTheDocument()
    expect(screen.getByText('반대 의견:')).toBeInTheDocument()
  })

  it('does not render dissentReason when null', () => {
    render(
      <ThesisList theses={[createThesis({ dissentReason: null })]} />,
    )

    expect(screen.queryByText('반대 의견:')).not.toBeInTheDocument()
  })

  it('renders multiple theses', () => {
    const theses = [
      createThesis({ id: 1, thesis: '첫 번째 전망' }),
      createThesis({ id: 2, thesis: '두 번째 전망' }),
    ]

    render(<ThesisList theses={theses} />)

    expect(screen.getByText('첫 번째 전망')).toBeInTheDocument()
    expect(screen.getByText('두 번째 전망')).toBeInTheDocument()
  })
})
