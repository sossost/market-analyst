/**
 * executeIssue.ts — Phase 2 신규 기능 단위 테스트
 *
 * PR 생성 성공 시 Discord 스레드 생성 + 매핑 저장 호출 검증.
 * 외부 의존성(execFile, gh CLI, Discord API)은 vi.fn()으로 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractBranchType,
  buildClaudePrompt,
  isCiFailureIssue,
  parseCiFailureBranch,
  parseCiFailurePrNumber,
  buildCiFixPrompt,
} from '../executeIssue.js'

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
  const prompt = buildClaudePrompt(issue, 'feat')

  it('기획서 작성 지시를 포함한다', () => {
    expect(prompt).toContain('기획서')
  })

  it('코드 셀프 리뷰 지시를 포함한다', () => {
    expect(prompt).toContain('셀프 리뷰')
  })

  it('main 복귀 지시를 포함한다', () => {
    expect(prompt).toContain('git checkout main')
  })

  it('이슈 번호와 브랜치 이름을 프롬프트에 삽입한다', () => {
    expect(prompt).toContain(`#${issue.number}`)
    expect(prompt).toContain('feat/issue-99')
    expect(prompt).toContain(`Closes #${issue.number}`)
  })

  it('이슈 본문을 untrusted-issue 블록 안에 격리한다', () => {
    const blockStart = prompt.indexOf('<untrusted-issue>')
    const blockEnd = prompt.indexOf('</untrusted-issue>')
    const bodyPosition = prompt.indexOf('테스트 본문')
    expect(blockStart).toBeGreaterThan(-1)
    expect(blockEnd).toBeGreaterThan(blockStart)
    expect(bodyPosition).toBeGreaterThan(blockStart)
    expect(bodyPosition).toBeLessThan(blockEnd)
  })

  it('feat 이슈일 때 README.md와 ROADMAP.md 문서 업데이트 지시를 포함한다', () => {
    expect(prompt).toContain('README.md')
    expect(prompt).toContain('docs/ROADMAP.md')
    expect(prompt).toContain('feat 또는 아키텍처 변경 이슈인 경우')
  })

  it('fix 이슈일 때도 문서 업데이트 불필요 명시를 포함한다', () => {
    const fixPrompt = buildClaudePrompt(
      { number: 100, title: 'fix: 버그 수정', body: '', labels: [], author: 'test' },
      'fix',
    )
    expect(fixPrompt).toContain('단순 fix/test/chore 이슈는 문서 업데이트 불필요')
  })
})

// ---------------------------------------------------------------------------
// buildClaudePrompt — triageComment 연동 검증
// ---------------------------------------------------------------------------

describe('buildClaudePrompt — triageComment 연동', () => {
  const issue = { number: 99, title: 'feat: 테스트', body: '테스트 본문', labels: [], author: 'test' }

  it('triageComment가 없으면 기존 자체 검증 지시를 포함한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat')

    expect(prompt).toContain('골 정렬: "Phase 2 주도섹터/주도주 초입 포착"')
    expect(prompt).toContain('무효 판정: LLM 백테스트')
    expect(prompt).not.toContain('사전 트리아지 분석')
    expect(prompt).not.toContain('사전 트리아지에서 검증 완료')
  })

  it('triageComment가 있으면 사전 트리아지 분석 섹션을 추가한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat', '트리아지 분석 내용')

    expect(prompt).toContain('## 사전 트리아지 분석')
    expect(prompt).toContain('트리아지 분석 내용')
  })

  it('triageComment가 있으면 골 정렬 자체 검증을 사전 트리아지 참조로 대체한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat', '분석')

    expect(prompt).toContain('사전 트리아지에서 골 정렬 및 무효 판정 검증 완료')
    expect(prompt).not.toContain('골 정렬: "Phase 2 주도섹터/주도주 초입 포착"')
    expect(prompt).not.toContain('무효 판정: LLM 백테스트')
  })

  it('triageComment가 있어도 기본 프로토콜은 유지한다', () => {
    const prompt = buildClaudePrompt(issue, 'feat', '분석')

    expect(prompt).toContain('기획서')
    expect(prompt).toContain('셀프 리뷰')
    expect(prompt).toContain('git checkout main')
    expect(prompt).toContain('untrusted-issue')
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

// ---------------------------------------------------------------------------
// CI 실패 이슈 감지 테스트
// ---------------------------------------------------------------------------

describe('isCiFailureIssue', () => {
  it('정확한 CI 실패 이슈 타이틀 패턴을 감지한다', () => {
    expect(isCiFailureIssue('fix: CI 실패 — feat: 새 기능 (#42)')).toBe(true)
  })

  it('PR 번호가 다른 패턴도 감지한다', () => {
    expect(isCiFailureIssue('fix: CI 실패 — chore: 업데이트 (#999)')).toBe(true)
  })

  it('일반 이슈 타이틀은 false를 반환한다', () => {
    expect(isCiFailureIssue('fix: 버그 수정')).toBe(false)
    expect(isCiFailureIssue('feat: 새 기능 추가')).toBe(false)
  })

  it('CI 실패 문자열이 포함되어도 패턴이 맞지 않으면 false를 반환한다', () => {
    // PR 번호 없음
    expect(isCiFailureIssue('fix: CI 실패 — 뭔가')).toBe(false)
    // fix: 접두사 없음
    expect(isCiFailureIssue('CI 실패 — feat: 기능 (#1)')).toBe(false)
  })

  it('빈 문자열은 false를 반환한다', () => {
    expect(isCiFailureIssue('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseCiFailureBranch
// ---------------------------------------------------------------------------

describe('parseCiFailureBranch', () => {
  it('이슈 본문에서 브랜치명을 추출한다', () => {
    const body = '**PR**: https://example.com\n**브랜치**: `feat/issue-100`\n\n### 실패 Job'
    expect(parseCiFailureBranch(body)).toBe('feat/issue-100')
  })

  it('브랜치명이 없으면 null을 반환한다', () => {
    expect(parseCiFailureBranch('일반 이슈 본문')).toBeNull()
  })

  it('빈 본문이면 null을 반환한다', () => {
    expect(parseCiFailureBranch('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseCiFailurePrNumber
// ---------------------------------------------------------------------------

describe('parseCiFailurePrNumber', () => {
  it('이슈 본문에서 PR 번호를 추출한다', () => {
    const body = 'PR #42의 CI가 실패했습니다.\n\n**PR**: https://example.com'
    expect(parseCiFailurePrNumber(body)).toBe(42)
  })

  it('PR 번호가 없으면 null을 반환한다', () => {
    expect(parseCiFailurePrNumber('일반 본문')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildCiFixPrompt
// ---------------------------------------------------------------------------

describe('buildCiFixPrompt', () => {
  const issue = {
    number: 200,
    title: 'fix: CI 실패 — feat: 새 기능 (#42)',
    body: '## CI 실패\n\nPR #42의 CI가 실패했습니다.\n**브랜치**: `feat/issue-42`\n\n에러 로그...',
    labels: ['bug', 'P1: high'],
    author: 'sossost',
  }
  const branchName = 'feat/issue-42'

  it('기존 브랜치 checkout 지시를 포함한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).toContain(`git checkout ${branchName}`)
    expect(prompt).toContain(`git pull origin ${branchName}`)
  })

  it('새 브랜치 생성 금지 지시를 포함한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).toContain('새 브랜치를 생성하지 마라')
  })

  it('새 PR 생성 금지 지시를 포함한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).toContain('새 PR을 생성하지 마라')
  })

  it('main 복귀 지시를 포함한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).toContain('git checkout main')
  })

  it('이슈 본문을 untrusted-issue 블록에 격리한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    const blockStart = prompt.indexOf('<untrusted-issue>')
    const blockEnd = prompt.indexOf('</untrusted-issue>')
    expect(blockStart).toBeGreaterThan(-1)
    expect(blockEnd).toBeGreaterThan(blockStart)
  })

  it('이슈 번호를 커밋 메시지에 포함한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).toContain(`Refs #${issue.number}`)
  })

  it('기획서 작성 지시를 포함하지 않는다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).not.toContain('기획서')
  })

  it('git push 지시에 브랜치명을 포함한다', () => {
    const prompt = buildCiFixPrompt(issue, branchName)
    expect(prompt).toContain(`git push origin ${branchName}`)
  })
})

// ---------------------------------------------------------------------------
// executeCiFailureIssue
// ---------------------------------------------------------------------------

describe('executeCiFailureIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('브랜치명 파싱 실패 시 auto:blocked 라벨을 추가하고 에러를 반환한다', async () => {
    const { addComment, addLabel } = await import('../githubClient.js')
    const { executeCiFailureIssue } = await import('../executeIssue.js')

    const result = await executeCiFailureIssue({
      number: 200,
      title: 'fix: CI 실패 — feat: 새 기능 (#42)',
      body: '브랜치 정보 없는 본문',
      labels: [],
      author: 'sossost',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Branch name not found')
    expect(addLabel).toHaveBeenCalledWith(200, 'auto:blocked')
    expect(addComment).toHaveBeenCalledOnce()
  })

  it('CLI 성공 시 auto:done 라벨과 완료 코멘트를 추가한다', async () => {
    const { execFile } = await import('node:child_process')
    const { addLabel, removeLabel, addComment } = await import('../githubClient.js')

    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(null, 'CI 수정 완료', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { executeCiFailureIssue } = await import('../executeIssue.js')
    const result = await executeCiFailureIssue({
      number: 200,
      title: 'fix: CI 실패 — feat: 새 기능 (#42)',
      body: '## CI 실패\n\nPR #42의 CI가 실패했습니다.\n\n**브랜치**: `feat/issue-42`',
      labels: [],
      author: 'sossost',
    })

    expect(result.success).toBe(true)
    expect(addLabel).toHaveBeenCalledWith(200, 'auto:in-progress')
    expect(removeLabel).toHaveBeenCalledWith(200, 'auto:in-progress')
    expect(addLabel).toHaveBeenCalledWith(200, 'auto:done')
    expect(addComment).toHaveBeenCalledOnce()
    const commentBody = vi.mocked(addComment).mock.calls[0][1]
    expect(commentBody).toContain('feat/issue-42')
    expect(commentBody).toContain('PR #42')
  })

  it('CLI 실패 시 에러 코멘트를 남긴다', async () => {
    const { execFile } = await import('node:child_process')
    const { addComment } = await import('../githubClient.js')

    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: Error, stdout: string, stderr: string) => void
      const error = new Error('CLI 실패') as NodeJS.ErrnoException
      cb(error, '', 'stderr output')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { executeCiFailureIssue } = await import('../executeIssue.js')
    const result = await executeCiFailureIssue({
      number: 200,
      title: 'fix: CI 실패 — feat: 새 기능 (#42)',
      body: '**브랜치**: `feat/issue-42`\n\nPR #42의 CI가 실패했습니다.',
      labels: [],
      author: 'sossost',
    })

    expect(result.success).toBe(false)
    expect(addComment).toHaveBeenCalledOnce()
    const commentBody = vi.mocked(addComment).mock.calls[0][1]
    expect(commentBody).toContain('실패')
  })
})
