import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '@/issue-processor/types'

// githubClient 모킹
vi.mock('@/issue-processor/githubClient', () => ({
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  addComment: vi.fn(),
}))

// child_process 모킹 — exec (셸 경유)
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}))

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}))

// fs/promises 모킹
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import { exec } from 'node:child_process'
import { addLabel, removeLabel, addComment } from '@/issue-processor/githubClient'
import { executeIssue, extractBranchType } from '@/issue-processor/executeIssue'

const mockExec = vi.mocked(exec)
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
    vi.mocked(mockExec).mockResolvedValueOnce({
      stdout: '작업 완료\nhttps://github.com/sossost/market-analyst/pull/99\n',
      stderr: '',
    } as any)

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
    vi.mocked(mockExec).mockResolvedValueOnce({
      stdout: '뭔가 했지만 PR 링크 없음',
      stderr: '',
    } as any)

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('PR URL을 확인할 수 없습니다'),
    )
  })

  it('CLI 실행 실패 시 에러 코멘트를 남긴다', async () => {
    const error = new Error('Command timed out') as Error & { stderr?: string }
    error.stderr = 'timeout exceeded'
    vi.mocked(mockExec).mockRejectedValueOnce(error)

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('timeout'),
    )
  })

  it('Claude Code CLI에 올바른 명령을 실행한다', async () => {
    vi.mocked(mockExec).mockResolvedValueOnce({
      stdout: 'https://github.com/sossost/market-analyst/pull/100',
      stderr: '',
    } as any)

    await executeIssue(sampleIssue)

    const callArgs = (mockExec as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const command = callArgs[0] as string
    expect(command).toContain('claude -p')
    expect(command).toContain('--output-format text')
    expect(command).toContain('--dangerously-skip-permissions')
  })

  it('이슈 타이틀에서 브랜치 타입을 추출하여 사용한다', async () => {
    vi.mocked(mockExec).mockResolvedValueOnce({
      stdout: 'https://github.com/sossost/market-analyst/pull/101',
      stderr: '',
    } as any)

    const featIssue: GitHubIssue = {
      number: 50,
      title: 'feat: 새로운 기능',
      body: '기능 추가',
      labels: ['feature'],
      author: 'sossost',
    }

    await executeIssue(featIssue)

    // writeFile로 프롬프트에 feat/issue-50이 포함됐는지 확인
    const { writeFile } = await import('node:fs/promises')
    const writeCall = vi.mocked(writeFile).mock.calls[0]
    const promptContent = writeCall[1] as string
    expect(promptContent).toContain('feat/issue-50')
  })
})
