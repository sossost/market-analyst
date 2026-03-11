import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { DashboardReport } from '../types'

vi.mock('../lib/supabase-queries', () => ({
  fetchLatestDailyReport: vi.fn(),
}))

import { fetchLatestDailyReport } from '../lib/supabase-queries'
import { DailyReportCard } from './DailyReportCard'

const mockFetchLatestDailyReport = vi.mocked(fetchLatestDailyReport)

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

async function renderCard() {
  const ui = await DailyReportCard()
  return render(ui)
}

describe('DailyReportCard', () => {
  it('"오늘의 리포트" 타이틀 렌더링', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(createReport())

    await renderCard()

    expect(screen.getByText('오늘의 리포트')).toBeInTheDocument()
  })

  it('fetch가 null을 반환하면 빈 상태 메시지 표시', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(null)

    await renderCard()

    expect(screen.getByText('리포트 데이터가 없습니다')).toBeInTheDocument()
  })

  it('fetch가 null을 반환하면 "상세 보기" 링크 없음', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(null)

    await renderCard()

    expect(screen.queryByText('상세 보기 →')).not.toBeInTheDocument()
  })

  it('fetch 실패 시 에러가 throw되어 ErrorBoundary로 전파됨', async () => {
    mockFetchLatestDailyReport.mockRejectedValue(new Error('DB 오류'))

    await expect(DailyReportCard()).rejects.toThrow('DB 오류')
  })

  it('리포트 날짜, phase2 비율, 총 분석 종목 수 렌더링', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(createReport())

    await renderCard()

    expect(screen.getByText('2026-03-11')).toBeInTheDocument()
    expect(screen.getByText('42.5%')).toBeInTheDocument()
    expect(screen.getByText('500종목')).toBeInTheDocument()
  })

  it('주도 섹터 배지 렌더링', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(
      createReport({ leadingSectors: ['Technology', 'Healthcare'] }),
    )

    await renderCard()

    expect(screen.getByText('Technology')).toBeInTheDocument()
    expect(screen.getByText('Healthcare')).toBeInTheDocument()
  })

  it('주도 섹터가 없으면 "-" 표시', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(
      createReport({ leadingSectors: [] }),
    )

    await renderCard()

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('"상세 보기" 링크가 올바른 href를 가짐', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(
      createReport({ reportDate: '2026-03-11' }),
    )

    await renderCard()

    const link = screen.getByText('상세 보기 →')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/reports/2026-03-11')
  })

  it('추천 종목 수 렌더링', async () => {
    mockFetchLatestDailyReport.mockResolvedValue(
      createReport({ symbolCount: 5 }),
    )

    await renderCard()

    expect(screen.getByText('5종목')).toBeInTheDocument()
  })
})
