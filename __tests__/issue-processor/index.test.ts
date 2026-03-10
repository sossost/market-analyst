import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue, TriageResult } from '@/issue-processor/types'

// 환경 변수 설정 (triageIssue 모듈 로드 전)
vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')

vi.mock('@/issue-processor/githubClient', () => ({
  fetchUnprocessedIssues: vi.fn(),
  fetchQueuedIssues: vi.fn(),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  addComment: vi.fn(),
}))

vi.mock('@/issue-processor/triageIssue', () => ({
  triageIssue: vi.fn(),
}))

vi.mock('@/issue-processor/executeIssue', () => ({
  executeIssue: vi.fn(),
}))

import {
  fetchUnprocessedIssues,
  fetchQueuedIssues,
  addLabel,
  addComment,
} from '@/issue-processor/githubClient'
import { triageIssue } from '@/issue-processor/triageIssue'
import { executeIssue } from '@/issue-processor/executeIssue'
import {
  processTriageQueue,
  processExecutionQueue,
  decodeTriageMeta,
} from '@/issue-processor/index'

const mockFetchUnprocessed = vi.mocked(fetchUnprocessedIssues)
const mockFetchQueued = vi.mocked(fetchQueuedIssues)
const mockAddLabel = vi.mocked(addLabel)
const mockAddComment = vi.mocked(addComment)
const mockTriageIssue = vi.mocked(triageIssue)
const mockExecuteIssue = vi.mocked(executeIssue)

function makeIssue(number: number): GitHubIssue {
  return {
    number,
    title: `이슈 #${number}`,
    body: `이슈 ${number} 본문`,
    labels: ['bug'],
  }
}

function makeTriageResult(
  issueNumber: number,
  decision: 'auto' | 'needs-ceo',
): TriageResult {
  return {
    issueNumber,
    decision,
    reason: decision === 'auto' ? '자율 처리 가능' : 'CEO 판단 필요',
    branchType: 'fix',
  }
}

describe('processTriageQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('auto 판정 이슈에 auto:queued 라벨을 붙인다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([makeIssue(1)])
    mockTriageIssue.mockResolvedValueOnce(makeTriageResult(1, 'auto'))

    await processTriageQueue()

    expect(mockAddLabel).toHaveBeenCalledWith(1, 'auto:queued')
    expect(mockAddComment).toHaveBeenCalledWith(
      1,
      expect.stringContaining('자율 처리 가능'),
    )
  })

  it('needs-ceo 판정 이슈에 auto:needs-ceo 라벨을 붙인다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([makeIssue(2)])
    mockTriageIssue.mockResolvedValueOnce(makeTriageResult(2, 'needs-ceo'))

    await processTriageQueue()

    expect(mockAddLabel).toHaveBeenCalledWith(2, 'auto:needs-ceo')
    expect(mockAddComment).toHaveBeenCalledWith(
      2,
      expect.stringContaining('CEO 판단'),
    )
  })

  it('트리아지 실패해도 다음 이슈를 계속 처리한다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([
      makeIssue(1),
      makeIssue(2),
    ])
    mockTriageIssue
      .mockRejectedValueOnce(new Error('API 에러'))
      .mockResolvedValueOnce(makeTriageResult(2, 'auto'))

    await processTriageQueue()

    // 이슈 1은 실패 → 라벨 없음
    // 이슈 2는 성공 → auto:queued
    expect(mockAddLabel).toHaveBeenCalledTimes(1)
    expect(mockAddLabel).toHaveBeenCalledWith(2, 'auto:queued')
  })

  it('auto 판정 코멘트에 triage-meta JSON이 포함된다', async () => {
    mockFetchUnprocessed.mockResolvedValueOnce([makeIssue(1)])
    mockTriageIssue.mockResolvedValueOnce(makeTriageResult(1, 'auto'))

    await processTriageQueue()

    const commentBody = mockAddComment.mock.calls[0][1]
    expect(commentBody).toContain('<!-- triage-meta:')
    expect(commentBody).toContain('"branchType":"fix"')
  })
})

describe('processExecutionQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queued 이슈를 최대 MAX_ISSUES_PER_CYCLE건만 실행한다', async () => {
    mockFetchQueued.mockResolvedValueOnce([
      makeIssue(1),
      makeIssue(2),
      makeIssue(3),
    ])
    mockExecuteIssue.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/test/pull/1',
    })

    await processExecutionQueue()

    // MAX_ISSUES_PER_CYCLE = 2 → 3개 중 2개만 실행
    expect(mockExecuteIssue).toHaveBeenCalledTimes(2)
  })

  it('실행 실패해도 다음 이슈를 계속 처리한다', async () => {
    mockFetchQueued.mockResolvedValueOnce([makeIssue(1), makeIssue(2)])
    mockExecuteIssue
      .mockRejectedValueOnce(new Error('실행 실패'))
      .mockResolvedValueOnce({ success: true, prUrl: 'url' })

    await processExecutionQueue()

    expect(mockExecuteIssue).toHaveBeenCalledTimes(2)
  })

  it('LLM을 재호출하지 않는다 (triageIssue 미호출)', async () => {
    mockFetchQueued.mockResolvedValueOnce([makeIssue(1)])
    mockExecuteIssue.mockResolvedValueOnce({ success: true, prUrl: 'url' })

    await processExecutionQueue()

    expect(mockTriageIssue).not.toHaveBeenCalled()
  })
})

describe('decodeTriageMeta', () => {
  it('코멘트에서 triage-meta JSON을 추출한다', () => {
    const comment =
      '자율 처리 가능\n\n<!-- triage-meta:{"branchType":"refactor","reason":"리팩토링"} -->'
    const meta = decodeTriageMeta(comment)

    expect(meta).toEqual({
      branchType: 'refactor',
      reason: '리팩토링',
    })
  })

  it('메타가 없으면 null 반환', () => {
    expect(decodeTriageMeta('일반 코멘트')).toBeNull()
  })

  it('잘못된 JSON이면 null 반환', () => {
    const comment = '<!-- triage-meta:invalid-json -->'
    expect(decodeTriageMeta(comment)).toBeNull()
  })
})
