import React from 'react'
import { render, screen } from '@testing-library/react'

import { CardError } from './CardError'

describe('CardError', () => {
  it('전달된 title을 렌더링', () => {
    render(<CardError title="오늘의 리포트" />)

    expect(screen.getByText('오늘의 리포트')).toBeInTheDocument()
  })

  it('"데이터를 불러올 수 없습니다" 에러 메시지 렌더링', () => {
    render(<CardError title="시장 레짐" />)

    expect(screen.getByText('데이터를 불러올 수 없습니다')).toBeInTheDocument()
  })

  it('다른 title에도 동일한 에러 메시지 렌더링', () => {
    render(<CardError title="Active Thesis" />)

    expect(screen.getByText('Active Thesis')).toBeInTheDocument()
    expect(screen.getByText('데이터를 불러올 수 없습니다')).toBeInTheDocument()
  })
})
