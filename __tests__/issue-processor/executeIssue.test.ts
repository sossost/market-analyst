import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '@/issue-processor/types'

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
import { executeIssue, extractBranchType } from '@/issue-processor/executeIssue'

const mockExecFile = vi.mocked(execFile)
const mockAddLabel = vi.mocked(addLabel)
const mockRemoveLabel = vi.mocked(removeLabel)
const mockAddComment = vi.mocked(addComment)

const sampleIssue: GitHubIssue = {
  number: 42,
  title: 'fix: 타입 에러',
  body: '타입 에러 수정 필요',
  labels: ['bug'],
  author: 'sossost',
}

describe('extractBranchType', () => {
  it('fix: 접두사에서 fix를 추출한다', () => {
    expect(extractBranchType('fix: 타입 에러')).toBe('fix')
  })

  it('feat: 접두사에서 feat를 추출한다', () => {
    expect(extractBranchType('feat: 새 기능')).toBe('feat')
  })

  it('refactor: 접두사에서 refactor를 추출한다', () => {
    expect(extractBranchType('refactor: 코드 정리')).toBe('refactor')
  })

  it('chore: 접두사에서 chore를 추출한다', () => {
    expect(extractBranchType('chore: 의존성 업데이트')).toBe('chore')
  })

  it('대소문자를 구분하지 않는다', () => {
    expect(extractBranchType('FIX: 대문자')).toBe('fix')
    expect(extractBranchType('Feat: 혼합')).toBe('feat')
  })

  it('매칭되지 않으면 기본값 fix를 반환한다', () => {
    expect(extractBranchType('알 수 없는 이슈')).toBe('fix')
    expect(extractBranchType('')).toBe('fix')
  })
})

describe('executeIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('성공 시 auto:done 라벨과 PR 링크 코멘트를 남긴다', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockResolvedValueOnce({
      stdout: '작업 완료\nhttps://github.com/sossost/market-analyst/pull/99\n',
    })

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe(
      'https://github.com/sossost/market-analyst/pull/99',
    )

    // 라벨 전환 확인
    expect(mockAddLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockAddLabel).toHaveBeenCalledWith(42, 'auto:done')

    // 완료 코멘트 확인
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('pull/99'),
    )
  })

  it('PR URL을 못 찾으면 실패 처리하고 코멘트를 남긴다', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockResolvedValueOnce({
      stdout: '뭔가 했지만 PR 링크 없음',
    })

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('PR URL을 확인할 수 없습니다'),
    )
  })

  it('CLI 실행 실패 시 에러 코멘트를 남긴다', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockRejectedValueOnce(
      new Error('Command timed out'),
    )

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
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

    await executeIssue(sampleIssue)

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

  it('이슈 타이틀에서 브랜치 타입을 추출하여 사용한다', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockExecFile as any).mockResolvedValueOnce({
      stdout: 'https://github.com/sossost/market-analyst/pull/101',
    })

    const featIssue: GitHubIssue = {
      number: 50,
      title: 'feat: 새로운 기능',
      body: '기능 추가',
      labels: ['feature'],
      author: 'sossost',
    }

    await executeIssue(featIssue)

    const callArgs = (mockExecFile as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    const prompt = callArgs[1][3]
    expect(prompt).toContain('feat/issue-50')
  })
})
