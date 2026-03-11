import React from 'react'
import { render } from '@testing-library/react'

import { DashboardSkeleton } from './DashboardSkeleton'

describe('DashboardSkeleton', () => {
  it('4개의 스켈레톤 카드를 렌더링한다', () => {
    const { container } = render(<DashboardSkeleton />)

    const cards = container.querySelectorAll('[data-slot="card"]')
    expect(cards).toHaveLength(4)
  })

  it('스켈레톤 요소를 렌더링한다', () => {
    const { container } = render(<DashboardSkeleton />)

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})
