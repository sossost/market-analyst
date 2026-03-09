import { render } from '@testing-library/react'

import { DebateListSkeleton } from './DebateListSkeleton'

describe('DebateListSkeleton', () => {
  it('renders 5 skeleton cards', () => {
    const { container } = render(<DebateListSkeleton />)

    const cards = container.querySelectorAll('[data-slot="card"]')
    expect(cards).toHaveLength(5)
  })

  it('renders without crashing', () => {
    expect(() => render(<DebateListSkeleton />)).not.toThrow()
  })
})
