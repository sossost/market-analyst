import { render, screen } from '@testing-library/react'

import { DebateEmptyState } from './DebateEmptyState'

describe('DebateEmptyState', () => {
  it('renders empty state message', () => {
    render(<DebateEmptyState />)

    expect(screen.getByText('토론 기록이 없습니다')).toBeInTheDocument()
  })

  it('renders sub-message', () => {
    render(<DebateEmptyState />)

    expect(
      screen.getByText('토론이 진행되면 이곳에 표시됩니다.'),
    ).toBeInTheDocument()
  })
})
