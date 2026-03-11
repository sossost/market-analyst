import React from 'react'
import { render, screen } from '@testing-library/react'

import type { RecentRegime } from '../types'
import { RegimeTimeline } from './RegimeTimeline'

function createRegime(overrides: Partial<RecentRegime> = {}): RecentRegime {
  return {
    regimeDate: '2026-03-11',
    regime: 'EARLY_BULL',
    rationale: 'Strong momentum',
    confidence: 'high',
    ...overrides,
  }
}

describe('RegimeTimeline', () => {
  it('regimes가 빈 배열이면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<RegimeTimeline regimes={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('각 레짐의 날짜(MM-DD) 렌더링', () => {
    const regimes = [
      createRegime({ regimeDate: '2026-03-11' }),
      createRegime({ regimeDate: '2026-03-10', regime: 'MID_BULL' }),
    ]

    render(<RegimeTimeline regimes={regimes} />)

    expect(screen.getByText('03-11')).toBeInTheDocument()
    expect(screen.getByText('03-10')).toBeInTheDocument()
  })

  it('"최근 레짐 추이" 레이블 렌더링', () => {
    render(<RegimeTimeline regimes={[createRegime()]} />)

    expect(screen.getByText('최근 레짐 추이')).toBeInTheDocument()
  })

  it('7개 레짐을 모두 렌더링', () => {
    const regimes = Array.from({ length: 7 }, (_, i) =>
      createRegime({ regimeDate: `2026-03-${String(11 - i).padStart(2, '0')}` }),
    )

    render(<RegimeTimeline regimes={regimes} />)

    for (let i = 5; i <= 11; i++) {
      const month = '03'
      const day = String(i).padStart(2, '0')
      expect(screen.getByText(`${month}-${day}`)).toBeInTheDocument()
    }
  })
})
