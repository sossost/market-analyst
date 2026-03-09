import React from 'react'
import { render } from '@testing-library/react'

import { ReportListSkeleton } from './ReportListSkeleton'

describe('ReportListSkeleton', () => {
  it('renders 5 skeleton items', () => {
    const { container } = render(<ReportListSkeleton />)

    const skeletonCards = container.querySelectorAll('.rounded-lg.border')

    expect(skeletonCards).toHaveLength(5)
  })
})
