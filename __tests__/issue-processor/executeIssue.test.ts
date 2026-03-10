import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue, TriageResult } from '@/issue-processor/types'

// githubClient 모킹
vi.mock('@/issue-processor/githubClient', () => ({
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  addComment: vi.fn(),
}))

// child_process 모킹
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}))

import { execFile } from 'node:child_process'
import { addLabel, removeLabel, addComment } from '@/issue-processor/githubClient'
import { executeIssue } from '@/issue-processor/executeIssue'

const mockExecFile = vi.mocked(execFile)
const mockAddLabel = vi.mocked(addLabel)
const mockRemoveLabel = vi.mocked(removeLabel)
const mockAddComment = vi.mocked(addComment)

const sampleIssue: GitHubIssue = {
  number: 42,
  title: 'fix: 타입 에러',
  body: '타입 에러 수정 필요',
  labels: ['bug'],

}

const sampleTriage: TriageResult = {
  issueNumber: 42,
  decision: 'auto',
  reason: '단순 타입 에러',
  branchType: 'fix',
}

describe('executeIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('성공 시 auto:done 라벨과 PR 링크 코멘트를 남긴다', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockResolvedValueOnce({
      stdout: '작업 완료\nhttps://github.com/sossost/market-analyst/pull/99\n',
    })

    const result = await executeIssue(sampleIssue, sampleTriage)

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe(
      'https://github.com/sossost/market-analyst/pull/99',
    )

    // 라벨 전환 확인
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:queued')
    expect(mockAddLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockAddLabel).toHaveBeenCalledWith(42, 'auto:done')

    // 완료 코멘트 확인
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('pull/99'),
    )
  })

  it('PR URL을 못 찾으면 auto:needs-ceo로 에스컬레이션', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockResolvedValueOnce({
      stdout: '뭔가 했지만 PR 링크 없음',
    })

    const result = await executeIssue(sampleIssue, sampleTriage)

    expect(result.success).toBe(false)
    expect(mockAddLabel).toHaveBeenCalledWith(42, 'auto:needs-ceo')
  })

  it('CLI 실행 실패 시 auto:needs-ceo + 에러 코멘트', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockRejectedValueOnce(
      new Error('Command timed out'),
    )

    const result = await executeIssue(sampleIssue, sampleTriage)

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(mockAddLabel).toHaveBeenCalledWith(42, 'auto:needs-ceo')
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('timed out'),
    )
  })

  it('Claude Code CLI에 올바른 프롬프트를 전달한다', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockResolvedValueOnce({
      stdout: 'https://github.com/sossost/market-analyst/pull/100',
    })

    await executeIssue(sampleIssue, sampleTriage)

    const callArgs = (mockExecFile as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(callArgs[0]).toBe('claude')
    expect(callArgs[1][0]).toBe('-p')
    expect(callArgs[1][1]).toBe('--output-format')
    expect(callArgs[1][2]).toBe('text')

    // 프롬프트는 4번째 인자 (index 3)
    const prompt = callArgs[1][3]
    expect(prompt).toContain('#42')
    expect(prompt).toContain('fix/issue-42')
    expect(prompt).toContain('Closes #42')
  })
})
