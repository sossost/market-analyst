import React from 'react'
import { render, screen } from '@testing-library/react'

import { RegimeBadge } from './RegimeBadge'

describe('RegimeBadge', () => {
  it('renders "Early Bull" for EARLY_BULL regime', () => {
    render(<RegimeBadge regime="EARLY_BULL" />)

    expect(screen.getByText('Early Bull')).toBeInTheDocument()
  })

  it('renders "Mid Bull" for MID_BULL regime', () => {
    render(<RegimeBadge regime="MID_BULL" />)

    expect(screen.getByText('Mid Bull')).toBeInTheDocument()
  })

  it('renders "Bear" for BEAR regime', () => {
    render(<RegimeBadge regime="BEAR" />)

    expect(screen.getByText('Bear')).toBeInTheDocument()
  })

  it('includes confidence suffix when provided', () => {
    render(<RegimeBadge regime="EARLY_BULL" confidence="high" />)

    expect(screen.getByText('Early Bull (high)')).toBeInTheDocument()
  })

  it('does not include confidence suffix when undefined', () => {
    render(<RegimeBadge regime="EARLY_BULL" />)

    expect(screen.getByText('Early Bull')).toBeInTheDocument()
    expect(screen.queryByText(/\(.*\)/)).not.toBeInTheDocument()
  })
})
