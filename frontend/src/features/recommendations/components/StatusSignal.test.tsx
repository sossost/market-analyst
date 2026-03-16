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

  describe('정상 진행 (currentPhase >= entryPhase)', () => {
    it('phaseDiff가 0이면 정상 진행을 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={2} status="ACTIVE" />,
      )
      expect(screen.getByText('정상 진행')).toBeInTheDocument()
    })

    it('phaseDiff가 양수이면 정상 진행을 표시한다', () => {
      render(
        <StatusSignal entryPhase={2} currentPhase={3} status="ACTIVE" />,
      )
      expect(screen.getByText('정상 진행')).toBeInTheDocument()
    })
  })

  describe('둔화 주의 (phaseDiff === -1)', () => {
    it('currentPhase가 entryPhase보다 1 낮으면 둔화 주의를 표시한다', () => {
      render(
        <StatusSignal entryPhase={3} currentPhase={2} status="ACTIVE" />,
      )
      expect(screen.getByText('둔화 주의')).toBeInTheDocument()
    })
  })

  describe('이탈 위험 (phaseDiff <= -2)', () => {
    it('currentPhase가 entryPhase보다 2 낮으면 이탈 위험을 표시한다', () => {
      render(
        <StatusSignal entryPhase={4} currentPhase={2} status="ACTIVE" />,
      )
      expect(screen.getByText('이탈 위험')).toBeInTheDocument()
    })

    it('currentPhase가 entryPhase보다 3 낮으면 이탈 위험을 표시한다', () => {
      render(
        <StatusSignal entryPhase={5} currentPhase={2} status="ACTIVE" />,
      )
      expect(screen.getByText('이탈 위험')).toBeInTheDocument()
    })
  })
})
