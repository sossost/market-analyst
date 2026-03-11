import React from 'react'
import { render, screen } from '@testing-library/react'

import type { DashboardReport } from '../types'
import { DailyReportCard } from './DailyReportCard'

function createReport(
  overrides: Partial<DashboardReport> = {},
): DashboardReport {
  return {
    id: 1,
    reportDate: '2026-03-11',
    phase2Ratio: 42.5,
    leadingSectors: ['Technology', 'Healthcare'],
    totalAnalyzed: 500,
    symbolCount: 3,
    ...overrides,
  }
}

describe('DailyReportCard', () => {
  it('"오늘의 리포트" 타이틀 렌더링', () => {
    render(<DailyReportCard report={createReport()} />)

    expect(screen.getByText('오늘의 리포트')).toBeInTheDocument()
  })

  it('report가 null이면 빈 상태 메시지 표시', () => {
    render(<DailyReportCard report={null} />)

    expect(screen.getByText('리포트 데이터가 없습니다')).toBeInTheDocument()
  })

  it('report가 null이면 "상세 보기" 링크 없음', () => {
    render(<DailyReportCard report={null} />)

    expect(screen.queryByText('상세 보기 →')).not.toBeInTheDocument()
  })

  it('리포트 날짜, phase2 비율, 총 분석 종목 수 렌더링', () => {
    render(<DailyReportCard report={createReport()} />)

    expect(screen.getByText('2026-03-11')).toBeInTheDocument()
    expect(screen.getByText('42.5%')).toBeInTheDocument()
    expect(screen.getByText('500종목')).toBeInTheDocument()
  })

  it('주도 섹터 배지 렌더링', () => {
    render(
      <DailyReportCard
        report={createReport({ leadingSectors: ['Technology', 'Healthcare'] })}
      />,
    )

    expect(screen.getByText('Technology')).toBeInTheDocument()
    expect(screen.getByText('Healthcare')).toBeInTheDocument()
  })

  it('주도 섹터가 없으면 "-" 표시', () => {
    render(<DailyReportCard report={createReport({ leadingSectors: [] })} />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('"상세 보기" 링크가 올바른 href를 가짐', () => {
    render(<DailyReportCard report={createReport({ reportDate: '2026-03-11' })} />)

    const link = screen.getByText('상세 보기 →')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/reports/2026-03-11')
  })

  it('추천 종목 수 렌더링', () => {
    render(<DailyReportCard report={createReport({ symbolCount: 5 })} />)

    expect(screen.getByText('5종목')).toBeInTheDocument()
  })
})
