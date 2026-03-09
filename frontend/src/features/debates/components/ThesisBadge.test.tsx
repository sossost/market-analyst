import { render, screen } from '@testing-library/react'

import { ThesisBadge } from './ThesisBadge'

describe('ThesisBadge', () => {
  it('renders ACTIVE label', () => {
    render(<ThesisBadge status="ACTIVE" />)

    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('renders CONFIRMED label', () => {
    render(<ThesisBadge status="CONFIRMED" />)

    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
  })

  it('renders INVALIDATED label', () => {
    render(<ThesisBadge status="INVALIDATED" />)

    expect(screen.getByText('INVALIDATED')).toBeInTheDocument()
  })

  it('renders EXPIRED label', () => {
    render(<ThesisBadge status="EXPIRED" />)

    expect(screen.getByText('EXPIRED')).toBeInTheDocument()
  })
})
