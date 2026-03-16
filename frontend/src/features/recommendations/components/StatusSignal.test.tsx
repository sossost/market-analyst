import React from 'react'
import { render, screen } from '@testing-library/react'

import { StatusSignal } from './StatusSignal'

describe('StatusSignal', () => {
  describe('ACTIVE가 아닌 경우 렌더링 없음', () => {
    it('CLOSED 상태이면 null을 반환한다', () => {
      const { container } = render(
        <StatusSignal entryPhase={2} currentPhase={3} status="CLOSED" />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('CLOSED_PHASE_EXIT 상태이면 null을 반환한다', () => {
      const { container } = render(
        <StatusSignal entryPhase={2} currentPhase={1} status="CLOSED_PHASE_EXIT" />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('STOPPED 상태이면 null을 반환한다', () => {
      const { container } = render(
        <StatusSignal entryPhase={2} currentPhase={2} status="STOPPED" />,
      )
      expect(container.firstChild).toBeNull()
    })
  })

  describe('ACTIVE 상태에서 currentPhase가 null인 경우', () => {
    it('데이터 없음 대시(—)를 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={null} status="ACTIVE" />,
      )
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('상승 유지 (currentPhase === 2)', () => {
    it('Phase 2 유지 시 상승 유지를 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={2} status="ACTIVE" />,
      )
      expect(screen.getByText('상승 유지')).toBeInTheDocument()
    })
  })

  describe('고점 접근 (currentPhase === 3)', () => {
    it('Phase 3 진입 시 고점 접근을 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={3} status="ACTIVE" />,
      )
      expect(screen.getByText('고점 접근')).toBeInTheDocument()
    })
  })

  describe('하락 전환 (currentPhase가 4, 5, 1)', () => {
    it('Phase 4 진입 시 하락 전환을 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={4} status="ACTIVE" />,
      )
      expect(screen.getByText('하락 전환')).toBeInTheDocument()
    })

    it('Phase 5 진입 시 하락 전환을 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={5} status="ACTIVE" />,
      )
      expect(screen.getByText('하락 전환')).toBeInTheDocument()
    })

    it('Phase 1 회귀 시 하락 전환을 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={1} status="ACTIVE" />,
      )
      expect(screen.getByText('하락 전환')).toBeInTheDocument()
    })
  })
})
