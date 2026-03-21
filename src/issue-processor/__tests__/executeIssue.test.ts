/**
 * executeIssue.ts — Phase 2 신규 기능 단위 테스트
 *
 * PR 생성 성공 시 Discord 스레드 생성 + 매핑 저장 호출 검증.
 * 외부 의존성(execFile, gh CLI, Discord API)은 vi.fn()으로 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractBranchType, buildClaudePrompt } from '../executeIssue.js'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('../githubClient.js', () => ({
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  addComment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../discordClient.js', () => ({
  createThread: vi.fn().mockResolvedValue('thread-new-123'),
}))

vi.mock('../prThreadStore.js', () => ({
  savePrThreadMapping: vi.fn(),
}))

// node:child_process execFile 모킹
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// ---------------------------------------------------------------------------
// buildClaudePrompt — 프로토콜 통일 검증
// ---------------------------------------------------------------------------

describe('buildClaudePrompt — 프로토콜 통일 검증', () => {
  const issue = { number: 99, title: 'feat: 테스트', body: '테스트 본문', labels: [], author: 'test' }

  it('기획서(plan.md) 작성 지시를 포함한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat')
    expect(prompt).toContain('plan.md')
    expect(prompt).toContain('기획서')
  })

  it('코드 셀프 리뷰 지시를 포함한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat')
    expect(prompt).toContain('셀프 리뷰')
  })

  it('main 복귀 지시를 포함한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat')
    expect(prompt).toContain('git checkout main')
  })

  it('이슈 번호와 브랜치 이름을 프롬프트에 삽입한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat')
    expect(prompt).toContain(`#${issue.number}`)
    expect(prompt).toContain('feat/issue-99')
    expect(prompt).toContain(`Closes #${issue.number}`)
  })

  it('이슈 본문을 untrusted-issue 블록 안에 격리한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat')
    const blockStart = prompt.indexOf('<untrusted-issue>')
    const blockEnd = prompt.indexOf('</untrusted-issue>')
    const bodyPosition = prompt.indexOf('테스트 본문')
    expect(blockStart).toBeGreaterThan(-1)
    expect(blockEnd).toBeGreaterThan(blockStart)
    expect(bodyPosition).toBeGreaterThan(blockStart)
    expect(bodyPosition).toBeLessThan(blockEnd)
  })
})

// ---------------------------------------------------------------------------
// extractBranchType 테스트
// ---------------------------------------------------------------------------

describe('extractBranchType', () => {
  it('feat: 접두사를 인식한다', () => {
    expect(extractBranchType('feat: 새 기능 추가')).toBe('feat')
  })

  it('fix: 접두사를 인식한다', () => {
    expect(extractBranchType('fix: 버그 수정')).toBe('fix')
  })

  it('refactor: 접두사를 인식한다', () => {
    expect(extractBranchType('refactor: 코드 정리')).toBe('refactor')
  })

  it('chore: 접두사를 인식한다', () => {
    expect(extractBranchType('chore: 의존성 업데이트')).toBe('chore')
  })

  it('알 수 없는 접두사는 fix를 반환한다', () => {
    expect(extractBranchType('docs: 문서 수정')).toBe('fix')
  })

  it('접두사 없으면 fix를 반환한다', () => {
    expect(extractBranchType('버그 수정 필요')).toBe('fix')
  })

  it('대소문자 무관하게 인식한다', () => {
    expect(extractBranchType('FEAT: 대문자 접두사')).toBe('feat')
  })
})

// ---------------------------------------------------------------------------
// executeIssue — Discord 스레드 생성 연동 테스트
// ---------------------------------------------------------------------------

describe('executeIssue — Discord 스레드 생성', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DISCORD_PR_CHANNEL_ID = 'channel-123'
    process.env.DISCORD_BOT_TOKEN = 'Bot test-token'
  })

  it('PR 생성 성공 시 Discord 스레드를 생성한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)
    const { createThread } = await import('../discordClient.js')
    const { savePrThreadMapping } = await import('../prThreadStore.js')

    // Claude CLI가 PR URL을 stdout에 출력하도록 모킹
    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (
        error: null,
        stdout: string,
        stderr: string,
      ) => void
      cb(null, 'PR이 생성되었습니다: https://github.com/owner/repo/pull/42', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { executeIssue } = await import('../executeIssue.js')
    const result = await executeIssue({
      number: 10,
      title: 'feat: 새 기능',
      body: '기능 설명',
      labels: [],
      author: 'sossost',
    })

    expect(result.success).toBe(true)
    expect(result.prUrl).toContain('/pull/42')
    expect(result.prNumber).toBe(42)
    expect(createThread).toHaveBeenCalledOnce()
    expect(savePrThreadMapping).toHaveBeenCalledOnce()

    // 저장된 매핑 검증
    const savedMapping = vi.mocked(savePrThreadMapping).mock.calls[0][0]
    expect(savedMapping.prNumber).toBe(42)
    expect(savedMapping.issueNumber).toBe(10)
    expect(savedMapping.threadId).toBe('thread-new-123')
    expect(savedMapping.branchName).toBe('feat/issue-10')
  })

  it('PR URL 없을 때는 Discord 스레드를 생성하지 않는다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)
    const { createThread } = await import('../discordClient.js')

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (
        error: null,
        stdout: string,
        stderr: string,
      ) => void
      cb(null, 'PR URL 없이 완료됨', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { executeIssue } = await import('../executeIssue.js')
    const result = await executeIssue({
      number: 10,
      title: 'feat: 새 기능',
      body: '',
      labels: [],
      author: 'sossost',
    })

    expect(result.success).toBe(false)
    expect(createThread).not.toHaveBeenCalled()
  })

  it('DISCORD_PR_CHANNEL_ID 미설정 시 스레드 생성을 스킵하고 PR은 성공 반환한다', async () => {
    delete process.env.DISCORD_PR_CHANNEL_ID

    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)
    const { createThread } = await import('../discordClient.js')

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (
        error: null,
        stdout: string,
        stderr: string,
      ) => void
      cb(null, 'https://github.com/owner/repo/pull/99', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { executeIssue } = await import('../executeIssue.js')
    const result = await executeIssue({
      number: 20,
      title: 'fix: 버그',
      body: '',
      labels: [],
      author: 'sossost',
    })

    expect(result.success).toBe(true)
    expect(createThread).not.toHaveBeenCalled()
  })

  it('Discord 스레드 생성 실패 시 PR 결과는 성공으로 반환된다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)
    const { createThread } = await import('../discordClient.js')

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (
        error: null,
        stdout: string,
        stderr: string,
      ) => void
      cb(null, 'https://github.com/owner/repo/pull/55', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    // Discord API 실패 시뮬레이션
    vi.mocked(createThread).mockRejectedValueOnce(new Error('Discord API 오류'))

    const { executeIssue } = await import('../executeIssue.js')
    const result = await executeIssue({
      number: 30,
      title: 'feat: 기능',
      body: '',
      labels: [],
      author: 'sossost',
    })

    // Discord 실패해도 PR 처리는 성공
    expect(result.success).toBe(true)
    expect(result.prUrl).toContain('/pull/55')
  })
})
