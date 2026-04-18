import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '@/issue-processor/types'

vi.mock('@/issue-processor/githubClient', () => ({
  fetchUnprocessedIssues: vi.fn(),
  fetchTriageComment: vi.fn(),
}))

vi.mock('@/issue-processor/executeIssue', () => ({
  executeIssue: vi.fn(),
  isCiFailureIssue: vi.fn().mockReturnValue(false),
  executeCiFailureIssue: vi.fn(),
}))

import { fetchUnprocessedIssues, fetchTriageComment } from '@/issue-processor/githubClient'
import { executeIssue } from '@/issue-processor/executeIssue'
import { processIssues } from '@/issue-processor/index'

const mockFetchUnprocessed = vi.mocked(fetchUnprocessedIssues)
const mockFetchTriageComment = vi.mocked(fetchTriageComment)
const mockExecuteIssue = vi.mocked(executeIssue)

function makeIssue(number: number): GitHubIssue {
  return {
    number,
    title: `fix: 이슈 #${number}`,
    body: `이슈 ${number} 본문`,
    labels: ['bug'],
    author: 'sossost',
  }
}

describe('processIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('미처리 이슈를 조회하여 바로 실행한다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([makeIssue(1)])
    mockExecuteIssue.mockResolvedValueOnce({
      success: true,
      prUrl: 'https://github.com/test/pull/1',
    })

    await processIssues()

    expect(mockFetchUnprocessed).toHaveBeenCalledOnce()
    expect(mockFetchTriageComment).toHaveBeenCalledWith(1)
    expect(mockExecuteIssue).toHaveBeenCalledWith(makeIssue(1), undefined)
  })

  it('최대 MAX_ISSUES_PER_CYCLE건만 실행한다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([
      makeIssue(1),
      makeIssue(2),
      makeIssue(3),
    ])
    mockExecuteIssue.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/test/pull/1',
    })

    await processIssues()

    // MAX_ISSUES_PER_CYCLE = 1 → 3개 중 1개만 실행
    expect(mockExecuteIssue).toHaveBeenCalledTimes(1)
  })

  it('미처리 이슈가 없으면 실행하지 않는다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([])

    await processIssues()

    expect(mockExecuteIssue).not.toHaveBeenCalled()
  })
})
