import { render, screen } from '@testing-library/react'

import type { DebateThesis, MarketRegimeSummary } from '../types'
import { SynthesisPanel } from './SynthesisPanel'

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

const MOCK_REGIME: MarketRegimeSummary = {
  regime: 'EARLY_BULL',
  rationale: '상승 초기',
  confidence: 'high',
}

describe('SynthesisPanel', () => {
  it('renders synthesis report text', () => {
    render(
      <SynthesisPanel
        synthesisReport="종합 분석 리포트 내용"
        theses={[]}
        regime={null}
      />,
    )

    expect(screen.getByText('종합 분석 리포트 내용')).toBeInTheDocument()
  })

  it('renders section headings', () => {
    render(
      <SynthesisPanel
        synthesisReport="리포트"
        theses={[]}
        regime={null}
      />,
    )

    expect(screen.getByText('종합 리포트')).toBeInTheDocument()
    expect(screen.getByText('Thesis 목록 (0건)')).toBeInTheDocument()
  })

  it('renders thesis count in heading', () => {
    const theses = [createThesis({ id: 1 }), createThesis({ id: 2 })]

    render(
      <SynthesisPanel
        synthesisReport="리포트"
        theses={theses}
        regime={null}
      />,
    )

    expect(screen.getByText('Thesis 목록 (2건)')).toBeInTheDocument()
  })

  it('renders regime badge when regime is provided', () => {
    render(
      <SynthesisPanel
        synthesisReport="리포트"
        theses={[]}
        regime={MOCK_REGIME}
      />,
    )

    expect(screen.getByText('시장 레짐:')).toBeInTheDocument()
  })

  it('does not render regime section when regime is null', () => {
    render(
      <SynthesisPanel
        synthesisReport="리포트"
        theses={[]}
        regime={null}
      />,
    )

    expect(screen.queryByText('시장 레짐:')).not.toBeInTheDocument()
  })

  it('renders thesis list content', () => {
    render(
      <SynthesisPanel
        synthesisReport="리포트"
        theses={[createThesis({ thesis: '테스트 전망' })]}
        regime={null}
      />,
    )

    expect(screen.getByText('테스트 전망')).toBeInTheDocument()
  })

  it('renders synthesisReport with markdown heading', () => {
    render(
      <SynthesisPanel
        synthesisReport={'# 종합 분석\n시장 상황을 분석합니다.'}
        theses={[]}
        regime={null}
      />,
    )

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByText('종합 분석')).toBeInTheDocument()
  })

  it('renders synthesisReport with bold text via markdown', () => {
    render(
      <SynthesisPanel
        synthesisReport="**핵심 결론**: 상승 초입 국면"
        theses={[]}
        regime={null}
      />,
    )

    const strong = screen.getByText('핵심 결론')
    expect(strong.tagName).toBe('STRONG')
  })
})
