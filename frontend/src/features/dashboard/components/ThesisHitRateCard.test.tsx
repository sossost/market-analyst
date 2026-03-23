import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { ThesisStats, CaptureLeadStats } from '../types'

vi.mock('../lib/supabase-queries', () => ({
  fetchThesisStats: vi.fn(),
  fetchCaptureLeadStats: vi.fn(),
}))

import { fetchThesisStats, fetchCaptureLeadStats } from '../lib/supabase-queries'
import { ThesisHitRateCard } from './ThesisHitRateCard'

const mockFetchThesisStats = vi.mocked(fetchThesisStats)
const mockFetchCaptureLeadStats = vi.mocked(fetchCaptureLeadStats)

function createThesisStats(
  overrides: Partial<ThesisStats> = {},
): ThesisStats {
  return {
    confirmedCount: 0,
    invalidatedCount: 0,
    activeCount: 0,
    expiredCount: 0,
    ...overrides,
  }
}

function createCaptureLeadStats(
  overrides: Partial<CaptureLeadStats> = {},
): CaptureLeadStats {
  return {
    totalResolved: 0,
    avgLeadDays: null,
    measurable: false,
    ...overrides,
  }
}

async function renderCard() {
  const ui = await ThesisHitRateCard()
  return render(ui)
}

describe('ThesisHitRateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('"Thesis KPI" 타이틀 렌더링', async () => {
    mockFetchThesisStats.mockResolvedValue(createThesisStats())
    mockFetchCaptureLeadStats.mockResolvedValue(createCaptureLeadStats())

    await renderCard()

    expect(screen.getByText('Thesis KPI')).toBeInTheDocument()
  })

  it('데이터 없으면 수집 중 상태 표시', async () => {
    mockFetchThesisStats.mockResolvedValue(createThesisStats())
    mockFetchCaptureLeadStats.mockResolvedValue(createCaptureLeadStats())

    await renderCard()

    expect(screen.getByText('데이터 수집 중 (0/20건)')).toBeInTheDocument()
  })

  it('적중률 계산 및 표시', async () => {
    mockFetchThesisStats.mockResolvedValue(
      createThesisStats({ confirmedCount: 8, invalidatedCount: 2 }),
    )
    mockFetchCaptureLeadStats.mockResolvedValue(createCaptureLeadStats())

    await renderCard()

    expect(screen.getByText('80.0%')).toBeInTheDocument()
    expect(screen.getByText('(8/10건)')).toBeInTheDocument()
  })

  it('20건 미만이면 "측정 중" 메시지 표시', async () => {
    mockFetchThesisStats.mockResolvedValue(
      createThesisStats({ confirmedCount: 5, invalidatedCount: 3 }),
    )
    mockFetchCaptureLeadStats.mockResolvedValue(createCaptureLeadStats())

    await renderCard()

    expect(screen.getByText('62.5%')).toBeInTheDocument()
    expect(screen.getByText('측정 중 (8/20건)')).toBeInTheDocument()
  })

  it('20건 이상이면 thesis 적중률 "측정 중" 메시지 없음', async () => {
    mockFetchThesisStats.mockResolvedValue(
      createThesisStats({ confirmedCount: 12, invalidatedCount: 8 }),
    )
    mockFetchCaptureLeadStats.mockResolvedValue(
      createCaptureLeadStats({ totalResolved: 15, avgLeadDays: 10, measurable: true }),
    )

    await renderCard()

    expect(screen.getByText('60.0%')).toBeInTheDocument()
    expect(screen.queryByText(/측정 중/)).not.toBeInTheDocument()
  })

  it('포착 선행성 미측정 시 진행 상태 표시', async () => {
    mockFetchThesisStats.mockResolvedValue(createThesisStats())
    mockFetchCaptureLeadStats.mockResolvedValue(
      createCaptureLeadStats({ totalResolved: 3, measurable: false }),
    )

    await renderCard()

    expect(screen.getByText('측정 중 (3/10건)')).toBeInTheDocument()
  })

  it('포착 선행성 측정 가능 시 평균 선행일수 표시', async () => {
    mockFetchThesisStats.mockResolvedValue(createThesisStats())
    mockFetchCaptureLeadStats.mockResolvedValue(
      createCaptureLeadStats({
        totalResolved: 12,
        avgLeadDays: 14,
        measurable: true,
      }),
    )

    await renderCard()

    expect(screen.getByText('평균 14일')).toBeInTheDocument()
  })

  it('Thesis 현황 breakdown 렌더링', async () => {
    mockFetchThesisStats.mockResolvedValue(
      createThesisStats({
        activeCount: 10,
        confirmedCount: 5,
        invalidatedCount: 3,
        expiredCount: 2,
      }),
    )
    mockFetchCaptureLeadStats.mockResolvedValue(createCaptureLeadStats())

    await renderCard()

    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('INVALIDATED')).toBeInTheDocument()
    expect(screen.getByText('EXPIRED')).toBeInTheDocument()
  })

  it('fetch 실패 시 에러가 throw되어 ErrorBoundary로 전파됨', async () => {
    mockFetchThesisStats.mockRejectedValue(new Error('DB 오류'))
    mockFetchCaptureLeadStats.mockResolvedValue(createCaptureLeadStats())

    await expect(ThesisHitRateCard()).rejects.toThrow('DB 오류')
  })
})
