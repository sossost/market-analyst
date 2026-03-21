/**
 * postReviewComment.ts — 단위 테스트
 *
 * gh CLI는 vi.mock으로 모킹. buildReviewComment 출력 구조 검증 포함.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildReviewComment, postReviewComment } from '../postReviewComment.js'
import { REVIEW_MARKER } from '../types.js'
import type { ReviewerOutput } from '../types.js'

// ---------------------------------------------------------------------------
// node:child_process 모킹
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// ---------------------------------------------------------------------------
// buildReviewComment 테스트
// ---------------------------------------------------------------------------

describe('buildReviewComment', () => {
  const successStrategic: ReviewerOutput = {
    type: 'strategic',
    prNumber: 42,
    success: true,
    output: '### Strategic Review\n\n골 정렬: SUPPORT\n종합: PROCEED\n\n**사유**\n테스트 통과',
  }

  const successCode: ReviewerOutput = {
    type: 'code',
    prNumber: 42,
    success: true,
    output: '### Code Review\n\n**이슈 목록**\n이슈 없음\n\n**종합**\nPASS\n\nCRITICAL/HIGH 이슈 수: 0개',
  }

  const failedStrategic: ReviewerOutput = {
    type: 'strategic',
    prNumber: 42,
    success: false,
    error: 'Claude CLI 타임아웃',
  }

  const failedCode: ReviewerOutput = {
    type: 'code',
    prNumber: 42,
    success: false,
    error: 'diff 조회 실패',
  }

  it('[자동 PR 리뷰] 마커를 포함한다', () => {
    const comment = buildReviewComment(successStrategic, successCode)
    expect(comment).toContain(REVIEW_MARKER)
  })

  it('Strategic Review 섹션을 포함한다', () => {
    const comment = buildReviewComment(successStrategic, successCode)
    expect(comment).toContain('## Strategic Review')
    expect(comment).toContain('PROCEED')
  })

  it('Code Review 섹션을 포함한다', () => {
    const comment = buildReviewComment(successStrategic, successCode)
    expect(comment).toContain('## Code Review')
    expect(comment).toContain('PASS')
  })

  it('두 섹션을 구분선(---)으로 나눈다', () => {
    const comment = buildReviewComment(successStrategic, successCode)
    expect(comment).toContain('---')
  })

  it('Strategic 리뷰 실패 시 실패 사유를 포함한다', () => {
    const comment = buildReviewComment(failedStrategic, successCode)
    expect(comment).toContain('리뷰 실패')
    expect(comment).toContain('Claude CLI 타임아웃')
    // Code 리뷰는 정상 출력
    expect(comment).toContain('PASS')
  })

  it('Code 리뷰 실패 시 실패 사유를 포함한다', () => {
    const comment = buildReviewComment(successStrategic, failedCode)
    expect(comment).toContain('리뷰 실패')
    expect(comment).toContain('diff 조회 실패')
    // Strategic 리뷰는 정상 출력
    expect(comment).toContain('PROCEED')
  })

  it('두 리뷰어 모두 실패 시 경고 메시지를 포함한다', () => {
    const comment = buildReviewComment(failedStrategic, failedCode)
    expect(comment).toContain('모두 실패')
    expect(comment).toContain('수동 리뷰')
  })

  it('마커가 코멘트 맨 앞에 위치한다', () => {
    const comment = buildReviewComment(successStrategic, successCode)
    expect(comment.startsWith(REVIEW_MARKER)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// postReviewComment 테스트
// ---------------------------------------------------------------------------

describe('postReviewComment', () => {
  const strategic: ReviewerOutput = {
    type: 'strategic',
    prNumber: 10,
    success: true,
    output: '### Strategic Review\n종합: PROCEED',
  }

  const code: ReviewerOutput = {
    type: 'code',
    prNumber: 10,
    success: true,
    output: '### Code Review\n**종합**\nPASS',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gh pr review --comment를 올바른 인자로 호출한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(null, '', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    await postReviewComment(10, strategic, code)

    const calls = vi.mocked(execFile).mock.calls
    expect(calls.length).toBe(1)
    const [cmd, args] = calls[0]
    expect(cmd).toBe('gh')
    expect(args).toContain('pr')
    expect(args).toContain('review')
    expect(args).toContain('--comment')
    expect(args).toContain('10')
    expect(args).toContain('--body')
  })

  it('코멘트 body에 [자동 PR 리뷰] 마커가 포함된다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(null, '', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    await postReviewComment(10, strategic, code)

    const args = vi.mocked(execFile).mock.calls[0][1] as string[]
    const bodyIndex = args.indexOf('--body')
    const body = args[bodyIndex + 1]
    expect(body).toContain(REVIEW_MARKER)
  })

  it('gh CLI 실패 시 에러를 throw하지 않고 로그만 남긴다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: Error, stdout: string, stderr: string) => void
      cb(new Error('PR이 클로즈됨'), '', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    // 에러가 throw되지 않아야 함
    await expect(postReviewComment(10, strategic, code)).resolves.toBeUndefined()
  })
})
