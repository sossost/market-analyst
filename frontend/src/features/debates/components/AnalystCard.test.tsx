import { render, screen } from '@testing-library/react'

import type { RoundOutput } from '../types'
import { AnalystCard } from './AnalystCard'

function createOutput(overrides: Partial<RoundOutput> = {}): RoundOutput {
  return {
    persona: 'macro',
    content: '거시경제 분석 내용입니다.',
    ...overrides,
  }
}

describe('AnalystCard', () => {
  it('renders persona label from PERSONA_LABELS', () => {
    render(<AnalystCard output={createOutput({ persona: 'macro' })} />)

    expect(screen.getByText('거시경제')).toBeInTheDocument()
  })

  it('renders tech persona label', () => {
    render(<AnalystCard output={createOutput({ persona: 'tech' })} />)

    expect(screen.getByText('기술분석')).toBeInTheDocument()
  })

  it('renders geopolitics persona label', () => {
    render(<AnalystCard output={createOutput({ persona: 'geopolitics' })} />)

    expect(screen.getByText('지정학')).toBeInTheDocument()
  })

  it('renders sentiment persona label', () => {
    render(<AnalystCard output={createOutput({ persona: 'sentiment' })} />)

    expect(screen.getByText('심리분석')).toBeInTheDocument()
  })

  it('renders content text', () => {
    render(
      <AnalystCard output={createOutput({ content: '시장 변동성 확대' })} />,
    )

    expect(screen.getByText('시장 변동성 확대')).toBeInTheDocument()
  })

  it('renders markdown content with heading', () => {
    render(
      <AnalystCard
        output={createOutput({ content: '## 매크로 분석\n금리 인하 사이클 진입' })}
      />,
    )

    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.getByText('금리 인하 사이클 진입')).toBeInTheDocument()
  })

  it('renders markdown content with bold text', () => {
    render(
      <AnalystCard
        output={createOutput({ content: '**핵심 지표**: 인플레이션 둔화 확인' })}
      />,
    )

    const strong = screen.getByText('핵심 지표')
    expect(strong.tagName).toBe('STRONG')
  })
})
