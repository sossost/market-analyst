import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { ActiveThesis } from '../types'

vi.mock('../lib/supabase-queries', () => ({
  fetchActiveTheses: vi.fn(),
}))

import { fetchActiveTheses } from '../lib/supabase-queries'
import { ActiveThesesCard } from './ActiveThesesCard'

const mockFetchActiveTheses = vi.mocked(fetchActiveTheses)

function createThesis(overrides: Partial<ActiveThesis> = {}): ActiveThesis {
  return {
    id: 1,
    agentPersona: 'macro',
    thesis: 'Tech sector will continue to outperform in Q2',
    timeframeDays: 30,
    confidence: 'high',
    consensusLevel: 'strong',
    category: 'sector',
    status: 'ACTIVE',
    nextBottleneck: 'Fed decision',
    dissentReason: null,
    ...overrides,
  }
}

async function renderCard() {
  const ui = await ActiveThesesCard()
  return render(ui)
}

describe('ActiveThesesCard', () => {
  it('"Active Thesis" 타이틀 렌더링', async () => {
    mockFetchActiveTheses.mockResolvedValue({ items: [], totalCount: 0 })

    await renderCard()

    expect(screen.getByText('Active Thesis')).toBeInTheDocument()
  })

  it('items가 빈 배열이면 빈 상태 메시지 표시', async () => {
    mockFetchActiveTheses.mockResolvedValue({ items: [], totalCount: 0 })

    await renderCard()

    expect(screen.getByText('활성 thesis가 없습니다')).toBeInTheDocument()
  })

  it('fetch 실패 시 에러가 throw되어 ErrorBoundary로 전파됨', async () => {
    mockFetchActiveTheses.mockRejectedValue(new Error('DB 오류'))

    await expect(ActiveThesesCard()).rejects.toThrow('DB 오류')
  })

  it('thesis 목록 렌더링', async () => {
    const theses = [
      createThesis({ id: 1, thesis: 'Tech outperform' }),
      createThesis({ id: 2, thesis: 'Energy sector rising', agentPersona: 'tech' }),
    ]
    mockFetchActiveTheses.mockResolvedValue({ items: theses, totalCount: 2 })

    await renderCard()

    expect(screen.getByText('Tech outperform')).toBeInTheDocument()
    expect(screen.getByText('Energy sector rising')).toBeInTheDocument()
  })

  it('totalCount > DISPLAY_LIMIT일 때 "더보기" 메시지 표시', async () => {
    const theses = [createThesis()]
    mockFetchActiveTheses.mockResolvedValue({ items: theses, totalCount: 15 })

    await renderCard()

    expect(screen.getByText(/외 \d+건 더 있음/)).toBeInTheDocument()
  })

  it('totalCount === theses.length이면 "더보기" 메시지 없음', async () => {
    const theses = [createThesis()]
    mockFetchActiveTheses.mockResolvedValue({ items: theses, totalCount: 1 })

    await renderCard()

    expect(screen.queryByText(/외 \d+건 더 있음/)).not.toBeInTheDocument()
  })

  it('"전체 보기" 링크가 /debates로 연결', async () => {
    mockFetchActiveTheses.mockResolvedValue({ items: [], totalCount: 0 })

    await renderCard()

    const link = screen.getByText('전체 보기 →')
    expect(link.closest('a')).toHaveAttribute('href', '/debates')
  })

  it('thesis의 기간, 합의 수준 렌더링', async () => {
    mockFetchActiveTheses.mockResolvedValue({
      items: [createThesis({ timeframeDays: 30, consensusLevel: 'strong' })],
      totalCount: 1,
    })

    await renderCard()

    expect(screen.getByText('기간: 30일')).toBeInTheDocument()
    expect(screen.getByText('합의: strong')).toBeInTheDocument()
  })
})
