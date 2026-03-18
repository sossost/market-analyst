import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '@/issue-processor/types'

// githubClient 모킹
vi.mock('@/issue-processor/githubClient', () => ({
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  addComment: vi.fn(),
}))

// child_process 모킹 — execFile (직접 호출)
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
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

/**
 * execFile 모킹 헬퍼 — callback 기반 + stdin mock
 */
function mockExecFileCall(
  stdout: string,
  stderr: string = '',
  error: Error | null = null,
): void {
  mockExecFile.mockImplementationOnce(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
      process.nextTick(() => cb(error, stdout, stderr))

      // stdin mock 반환
      return { stdin: { end: vi.fn() } } as never
    },
  )
}

function mockExecFileError(
  error: Error & { code?: string; killed?: boolean },
  stderr: string = '',
): void {
  mockExecFile.mockImplementationOnce(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
      process.nextTick(() => cb(error, '', stderr))

      return { stdin: { end: vi.fn() } } as never
    },
  )
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
    mockExecFileCall(
      '작업 완료\nhttps://github.com/sossost/market-analyst/pull/99\n',
    )

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
    mockExecFileCall('뭔가 했지만 PR 링크 없음')

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(mockRemoveLabel).toHaveBeenCalledWith(42, 'auto:in-progress')
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('PR URL을 확인할 수 없습니다'),
    )
  })

  it('ENOENT 에러 시 Claude CLI 미설치 메시지를 남긴다', async () => {
    const error = new Error('spawn claude ENOENT') as Error & { code?: string }
    error.code = 'ENOENT'
    mockExecFileError(error)

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Claude CLI를 찾을 수 없음')
    expect(mockAddComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Claude CLI를 찾을 수 없음'),
    )
  })

  it('타임아웃 시 분류된 에러 메시지를 남긴다', async () => {
    const error = new Error('Command timed out') as Error & { killed?: boolean }
    error.killed = true
    mockExecFileError(error)

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(result.error).toContain('타임아웃')
  })

  it('stderr가 있으면 에러 메시지에 포함한다', async () => {
    const error = new Error('Command failed')
    mockExecFileError(error, 'authentication failed: token expired')

    const result = await executeIssue(sampleIssue)

    expect(result.success).toBe(false)
    expect(result.error).toContain('authentication failed')
  })

  it('Claude CLI를 execFile로 직접 호출한다 (bash 경유 X)', async () => {
    mockExecFileCall(
      'https://github.com/sossost/market-analyst/pull/100',
    )

    await executeIssue(sampleIssue)

    // execFile 첫 번째 인자가 'claude'인지 확인
    const callArgs = mockExecFile.mock.calls[0]
    expect(callArgs[0]).toBe('claude')

    // args에 --print, --dangerously-skip-permissions 포함
    const args = callArgs[1] as string[]
    expect(args).toContain('--print')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--output-format')
    expect(args).toContain('text')
  })

  it('ANTHROPIC_API_KEY를 제거한 환경으로 실행한다', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    mockExecFileCall(
      'https://github.com/sossost/market-analyst/pull/101',
    )

    await executeIssue(sampleIssue)

    const callArgs = mockExecFile.mock.calls[0]
    const opts = callArgs[2] as { env?: NodeJS.ProcessEnv }
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined()

    delete process.env.ANTHROPIC_API_KEY
  })

  it('stdin으로 프롬프트를 전달한다', async () => {
    mockExecFileCall(
      'https://github.com/sossost/market-analyst/pull/102',
    )

    const featIssue: GitHubIssue = {
      number: 50,
      title: 'feat: 새로운 기능',
      body: '기능 추가',
      labels: ['feature'],
      author: 'sossost',
    }

    await executeIssue(featIssue)

    // stdin.end가 프롬프트와 함께 호출됐는지 확인
    const child = mockExecFile.mock.results[0].value as { stdin: { end: ReturnType<typeof vi.fn> } }
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining('feat/issue-50'),
      'utf-8',
    )
  })

  it('프롬프트에 PR 템플릿 참조와 전략비서 체크 지시를 포함한다', async () => {
    mockExecFileCall(
      'https://github.com/sossost/market-analyst/pull/103',
    )

    await executeIssue(sampleIssue)

    const child = mockExecFile.mock.results[0].value as { stdin: { end: ReturnType<typeof vi.fn> } }
    const prompt = child.stdin.end.mock.calls[0][0] as string

    // PR 템플릿 참조
    expect(prompt).toContain('.github/PULL_REQUEST_TEMPLATE.md')
    // Closes 지시
    expect(prompt).toContain(`Closes #${sampleIssue.number}`)
    // 전략비서 체크 지시
    expect(prompt).toContain('전략비서 체크')
    expect(prompt).toContain('골 정렬')
    expect(prompt).toContain('무기 품질')
    expect(prompt).toContain('무효 판정')
  })
})
