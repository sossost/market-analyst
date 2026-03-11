import React from 'react'
import { render, screen } from '@testing-library/react'

import { MetricItem } from './MetricItem'

describe('MetricItem', () => {
  it('label과 value를 렌더링한다', () => {
    render(<MetricItem label="Phase 2 비율" value="42.5%" />)

    expect(screen.getByText('Phase 2 비율')).toBeInTheDocument()
    expect(screen.getByText('42.5%')).toBeInTheDocument()
  })
})
