import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { PhaseTrajectoryPoint } from '../types'
import { PhaseTrajectoryChart } from './PhaseTrajectoryChart'

describe('PhaseTrajectoryChart', () => {
  const sampleData: PhaseTrajectoryPoint[] = [
    { date: '2026-01-01', phase: 2, rsScore: 85 },
    { date: '2026-01-15', phase: 2, rsScore: 88 },
    { date: '2026-02-01', phase: 3, rsScore: 75 },
    { date: '2026-02-15', phase: 3, rsScore: 70 },
    { date: '2026-03-01', phase: 2, rsScore: 90 },
  ]

  it('데이터가 비어있으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<PhaseTrajectoryChart data={[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('SVG 차트를 렌더링한다', () => {
    render(<PhaseTrajectoryChart data={sampleData} />)
    const svg = screen.getByRole('img', { name: 'Phase 궤적 차트' })
    expect(svg).toBeDefined()
  })

  it('데이터 포인트 수만큼 circle을 렌더링한다', () => {
    const { container } = render(<PhaseTrajectoryChart data={sampleData} />)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(sampleData.length)
  })

  it('단일 데이터 포인트도 렌더링한다', () => {
    const singlePoint: PhaseTrajectoryPoint[] = [
      { date: '2026-01-01', phase: 2, rsScore: 85 },
    ]
    const { container } = render(<PhaseTrajectoryChart data={singlePoint} />)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(1)
  })

  it('Y축에 Phase 라벨을 표시한다', () => {
    const { container } = render(<PhaseTrajectoryChart data={sampleData} />)
    const texts = container.querySelectorAll('text')
    const labels = Array.from(texts).map((t) => t.textContent)
    expect(labels).toContain('바닥 횡보')
    expect(labels).toContain('상승 초입')
  })
})
