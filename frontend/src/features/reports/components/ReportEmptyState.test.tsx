import React from 'react'
import { render, screen } from '@testing-library/react'

import { ReportEmptyState } from './ReportEmptyState'

describe('ReportEmptyState', () => {
  it('renders empty state messages', () => {
    render(<ReportEmptyState />)

    expect(screen.getByText('리포트가 없습니다')).toBeInTheDocument()
    expect(
      screen.getByText('리포트가 생성되면 이곳에 표시됩니다.'),
    ).toBeInTheDocument()
  })
})
