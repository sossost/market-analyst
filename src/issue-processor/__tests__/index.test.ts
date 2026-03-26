/**
 * index.ts — processIssues 통합 테스트
 *
 * 트리아지 판정(PROCEED/SKIP/ESCALATE)에 따른 분기 동작을 검증한다.
 * 외부 의존성(githubClient, triageIssue, executeIssue)은 모두 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '../types.js'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}))

vi.mock('../githubClient.js', () => ({
  fetchUnprocessedIssues: vi.fn(),
  addComment: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../triageIssue.js', () => ({
  triageIssue: vi.fn(),
}))

vi.mock('../executeIssue.js', () => ({
  executeIssue: vi.fn().mockResolvedValue({ success: true, prUrl: 'https://github.com/owner/repo/pull/1' }),
}))

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 10,
    title: 'feat: 새 기능',
    body: '기능 설명',
    labels: [],
    author: 'sossost',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// processIssues — 트리아지 통합 흐름
// ---------------------------------------------------------------------------

describe('processIssues — 트리아지 통합 흐름', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('미처리 이슈가 없으면 트리아지 및 executeIssue를 호출하지 않는다', async () => {
    const { fetchUnprocessedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([])

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(triageIssue).not.toHaveBeenCalled()
    expect(executeIssue).not.toHaveBeenCalled()
  })

  it('PROCEED — executeIssue를 호출하고 triageComment를 전달한다', async () => {
    const { fetchUnprocessedIssues, addComment } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '구현 가이드' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(triageIssue).toHaveBeenCalledOnce()
    expect(triageIssue).toHaveBeenCalledWith(issue)

    // 트리아지 코멘트가 이슈에 남겨진다
    expect(addComment).toHaveBeenCalledOnce()
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('구현 가이드')

    // executeIssue가 triageComment와 함께 호출된다
    expect(executeIssue).toHaveBeenCalledOnce()
    expect(executeIssue).toHaveBeenCalledWith(issue, '구현 가이드')
  })

  it('PROCEED + 빈 triageComment — executeIssue에 undefined를 전달한다', async () => {
    const { fetchUnprocessedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    // 빈 comment면 undefined 전달 (프롬프트에 triage 섹션 미삽입)
    expect(executeIssue).toHaveBeenCalledWith(issue, undefined)
  })

  it('SKIP — executeIssue를 호출하지 않고 auto:blocked 라벨을 부착한다', async () => {
    const { fetchUnprocessedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'SKIP', comment: '골 정렬 NEUTRAL' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    // executeIssue 미호출
    expect(executeIssue).not.toHaveBeenCalled()

    // 트리아지 코멘트 남김
    expect(addComment).toHaveBeenCalledOnce()
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('골 정렬 NEUTRAL')

    // auto:blocked 라벨 부착
    expect(addLabel).toHaveBeenCalledWith(issue.number, 'auto:blocked')
  })

  it('SKIP + 빈 comment — addComment를 호출하지 않는다', async () => {
    const { fetchUnprocessedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'SKIP', comment: '' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(executeIssue).not.toHaveBeenCalled()
    expect(addComment).not.toHaveBeenCalled()
    expect(addLabel).toHaveBeenCalledWith(issue.number, 'auto:blocked')
  })

  it('ESCALATE — executeIssue를 호출하지 않고 auto:needs-ceo 라벨을 부착한다', async () => {
    const { fetchUnprocessedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'ESCALATE', comment: '판단 불가' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    // executeIssue 미호출
    expect(executeIssue).not.toHaveBeenCalled()

    // 트리아지 코멘트 남김
    expect(addComment).toHaveBeenCalledOnce()
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('판단 불가')

    // auto:needs-ceo 라벨 부착
    expect(addLabel).toHaveBeenCalledWith(issue.number, 'auto:needs-ceo')
  })

  it('PROCEED — postTriageComment가 triage 코멘트 포함하여 호출된다', async () => {
    const { fetchUnprocessedIssues, addComment } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '원인 분석 내용' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    // 코멘트에 "[사전 트리아지]" 헤더와 분석 내용이 포함된다
    const commentBody = vi.mocked(addComment).mock.calls[0][1] as string
    expect(commentBody).toContain('[사전 트리아지]')
    expect(commentBody).toContain('원인 분석 내용')
  })

  it('MAX_ISSUES_PER_CYCLE 초과 이슈는 처리하지 않는다', async () => {
    const { fetchUnprocessedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    // 3개 이슈, MAX_ISSUES_PER_CYCLE = 1
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([
      createIssue({ number: 1 }),
      createIssue({ number: 2 }),
      createIssue({ number: 3 }),
    ])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '' })

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(triageIssue).toHaveBeenCalledOnce()
    expect(vi.mocked(triageIssue).mock.calls[0][0].number).toBe(1)
  })

  it('트리아지 에러 발생 시 해당 이슈를 스킵하고 다음 이슈로 계속 진행한다', async () => {
    const { fetchUnprocessedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([createIssue()])
    vi.mocked(triageIssue).mockRejectedValue(new Error('예상치 못한 에러'))

    const { processIssues } = await import('../index.js')
    // 에러가 전파되지 않아야 한다
    await expect(processIssues()).resolves.toBeUndefined()
    expect(executeIssue).not.toHaveBeenCalled()
  })
})
