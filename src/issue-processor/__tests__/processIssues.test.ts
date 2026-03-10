import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processIssues } from '../index.js'

vi.mock('../githubClient.js', () => ({
  fetchUnprocessedIssues: vi.fn(),
}))

vi.mock('../executeIssue.js', () => ({
  extractBranchType: vi.fn(),
  executeIssue: vi.fn(),
}))

import { fetchUnprocessedIssues } from '../githubClient.js'
import { executeIssue } from '../executeIssue.js'

const mockFetchUnprocessedIssues = vi.mocked(fetchUnprocessedIssues)
const mockExecuteIssue = vi.mocked(executeIssue)

const sampleIssue = (number: number) => ({
  number,
  title: `fix: 이슈 ${number}`,
  body: '이슈 본문',
  labels: [],
  author: 'sossost',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processIssues', () => {
  it('미처리 이슈가 없으면 executeIssue를 호출하지 않음', async () => {
    mockFetchUnprocessedIssues.mockResolvedValue([])

    await processIssues()

    expect(mockExecuteIssue).not.toHaveBeenCalled()
  })

  it('이슈 1건 → executeIssue 1회 호출', async () => {
    mockFetchUnprocessedIssues.mockResolvedValue([sampleIssue(1)])
    mockExecuteIssue.mockResolvedValue({ success: true, prUrl: 'https://github.com/sossost/market-analyst/pull/100' })

    await processIssues()

    expect(mockExecuteIssue).toHaveBeenCalledTimes(1)
    expect(mockExecuteIssue).toHaveBeenCalledWith(sampleIssue(1))
  })

  it('이슈 3건이면 MAX_ISSUES_PER_CYCLE(2)건만 처리', async () => {
    mockFetchUnprocessedIssues.mockResolvedValue([
      sampleIssue(1),
      sampleIssue(2),
      sampleIssue(3),
    ])
    mockExecuteIssue.mockResolvedValue({ success: true, prUrl: 'https://github.com/sossost/market-analyst/pull/100' })

    await processIssues()

    expect(mockExecuteIssue).toHaveBeenCalledTimes(2)
    expect(mockExecuteIssue).toHaveBeenCalledWith(sampleIssue(1))
    expect(mockExecuteIssue).toHaveBeenCalledWith(sampleIssue(2))
    expect(mockExecuteIssue).not.toHaveBeenCalledWith(sampleIssue(3))
  })

  it('executeIssue 실패해도 다음 이슈 계속 처리 (격리)', async () => {
    mockFetchUnprocessedIssues.mockResolvedValue([sampleIssue(1), sampleIssue(2)])
    mockExecuteIssue
      .mockRejectedValueOnce(new Error('첫 번째 이슈 실패'))
      .mockResolvedValueOnce({ success: true, prUrl: 'https://github.com/sossost/market-analyst/pull/101' })

    await processIssues()

    expect(mockExecuteIssue).toHaveBeenCalledTimes(2)
  })

  it('executeIssue success: false도 다음 이슈 계속 처리', async () => {
    mockFetchUnprocessedIssues.mockResolvedValue([sampleIssue(1), sampleIssue(2)])
    mockExecuteIssue
      .mockResolvedValueOnce({ success: false, error: 'PR URL not found' })
      .mockResolvedValueOnce({ success: true, prUrl: 'https://github.com/sossost/market-analyst/pull/102' })

    await processIssues()

    expect(mockExecuteIssue).toHaveBeenCalledTimes(2)
  })
})
