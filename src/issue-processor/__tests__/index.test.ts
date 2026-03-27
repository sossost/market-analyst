/**
 * index.ts — processIssues 통합 테스트
 *
 * 배치 트리아지(triageBatch)가 남긴 코멘트를 읽어
 * executeIssue에 triageComment로 전달하는 흐름을 검증한다.
 * 외부 의존성(githubClient, executeIssue)은 모두 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '../types.js'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}))

vi.mock('../githubClient.js', () => ({
  fetchUnprocessedIssues: vi.fn(),
  fetchTriageComment: vi.fn(),
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
// processIssues — fetchTriageComment 기반 흐름
// ---------------------------------------------------------------------------

describe('processIssues — fetchTriageComment 기반 흐름', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('미처리 이슈가 없으면 fetchTriageComment 및 executeIssue를 호출하지 않는다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([])

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(fetchTriageComment).not.toHaveBeenCalled()
    expect(executeIssue).not.toHaveBeenCalled()
  })

  it('트리아지 코멘트가 있으면 executeIssue에 triageComment를 전달한다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(fetchTriageComment).mockResolvedValue('구현 가이드 분석')

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(fetchTriageComment).toHaveBeenCalledWith(issue.number)
    expect(executeIssue).toHaveBeenCalledWith(issue, '구현 가이드 분석')
  })

  it('트리아지 코멘트가 없으면 executeIssue에 undefined를 전달한다 (폴백)', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([issue])
    vi.mocked(fetchTriageComment).mockResolvedValue(undefined)

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(executeIssue).toHaveBeenCalledWith(issue, undefined)
  })

  it('executeIssue 성공 시 결과를 로깅한다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([createIssue()])
    vi.mocked(fetchTriageComment).mockResolvedValue(undefined)
    vi.mocked(executeIssue).mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/owner/repo/pull/42',
    })

    const { processIssues } = await import('../index.js')
    await expect(processIssues()).resolves.toBeUndefined()
  })

  it('executeIssue 실패 시 에러 로깅 후 정상 종료한다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([createIssue()])
    vi.mocked(fetchTriageComment).mockResolvedValue(undefined)
    vi.mocked(executeIssue).mockResolvedValue({ success: false, error: '실행 오류' })

    const { processIssues } = await import('../index.js')
    await expect(processIssues()).resolves.toBeUndefined()
  })

  it('MAX_ISSUES_PER_CYCLE 초과 이슈는 처리하지 않는다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    // 3개 이슈, MAX_ISSUES_PER_CYCLE = 1
    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([
      createIssue({ number: 1 }),
      createIssue({ number: 2 }),
      createIssue({ number: 3 }),
    ])
    vi.mocked(fetchTriageComment).mockResolvedValue(undefined)

    const { processIssues } = await import('../index.js')
    await processIssues()

    expect(fetchTriageComment).toHaveBeenCalledOnce()
    expect(fetchTriageComment).toHaveBeenCalledWith(1)
    expect(executeIssue).toHaveBeenCalledOnce()
  })

  it('fetchTriageComment 에러 발생 시 이슈를 스킵하고 계속 진행한다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([createIssue()])
    vi.mocked(fetchTriageComment).mockRejectedValue(new Error('gh CLI 실패'))

    const { processIssues } = await import('../index.js')
    await expect(processIssues()).resolves.toBeUndefined()
    expect(executeIssue).not.toHaveBeenCalled()
  })

  it('executeIssue 예외 발생 시 이슈를 스킵하고 계속 진행한다', async () => {
    const { fetchUnprocessedIssues, fetchTriageComment } = await import('../githubClient.js')
    const { executeIssue } = await import('../executeIssue.js')

    vi.mocked(fetchUnprocessedIssues).mockResolvedValue([createIssue()])
    vi.mocked(fetchTriageComment).mockResolvedValue(undefined)
    vi.mocked(executeIssue).mockRejectedValue(new Error('예상치 못한 에러'))

    const { processIssues } = await import('../index.js')
    await expect(processIssues()).resolves.toBeUndefined()
  })
})
