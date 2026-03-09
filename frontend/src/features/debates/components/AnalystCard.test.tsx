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
})
