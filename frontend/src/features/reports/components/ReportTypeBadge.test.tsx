import React from 'react'
import { render, screen } from '@testing-library/react'

import { ReportTypeBadge } from './ReportTypeBadge'

describe('ReportTypeBadge', () => {
  it('renders "일간" for daily type', () => {
    render(<ReportTypeBadge type="daily" />)

    expect(screen.getByText('일간')).toBeInTheDocument()
  })

  it('renders "주간" for weekly type', () => {
    render(<ReportTypeBadge type="weekly" />)

    expect(screen.getByText('주간')).toBeInTheDocument()
  })
})
