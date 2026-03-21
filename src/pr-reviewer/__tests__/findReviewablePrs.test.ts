/**
 * findReviewablePrs.ts — 단위 테스트
 *
 * gh CLI는 vi.mock으로 모킹. 실제 네트워크 호출 없음.
 * promisify(execFile) 기반이므로 콜백 방식으로 mock한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isIssueBranch, hasReviewMarker } from '../findReviewablePrs.js'

// ---------------------------------------------------------------------------
// node:child_process 모킹
// promisify(execFile)은 내부적으로 execFile 콜백을 호출한다.
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  promisify: vi.fn(),
}))

// node:util 모킹 — promisify가 execFile mock을 감싸도록 설정
vi.mock('node:util', () => ({
  promisify: (fn: unknown) => {
    // execFile mock을 Promise 기반으로 변환하는 헬퍼를 반환
    return (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        // promisify를 위해 callback 추가
        ;(fn as Function)(...args, (err: Error | null, stdout: string) => {
          if (err != null) {
            reject(err)
          } else {
            resolve({ stdout })
          }
        })
      })
  },
}))

// ---------------------------------------------------------------------------
// isIssueBranch 테스트
// ---------------------------------------------------------------------------

describe('isIssueBranch', () => {
  it('fix/issue-* 브랜치는 true를 반환한다', () => {
    expect(isIssueBranch('fix/issue-123')).toBe(true)
  })

  it('feat/issue-* 브랜치는 true를 반환한다', () => {
    expect(isIssueBranch('feat/issue-42')).toBe(true)
  })

  it('refactor/issue-* 브랜치는 true를 반환한다', () => {
    expect(isIssueBranch('refactor/issue-1')).toBe(true)
  })

  it('chore/issue-* 브랜치는 true를 반환한다', () => {
    expect(isIssueBranch('chore/issue-999')).toBe(true)
  })

  it('main 브랜치는 false를 반환한다', () => {
    expect(isIssueBranch('main')).toBe(false)
  })

  it('feature/my-feature 같은 수동 브랜치는 false를 반환한다', () => {
    expect(isIssueBranch('feature/my-feature')).toBe(false)
  })

  it('fix/some-thing 처럼 issue- 없는 브랜치는 false를 반환한다', () => {
    expect(isIssueBranch('fix/some-thing')).toBe(false)
  })

  it('fix/issue-abc 처럼 숫자 없는 브랜치는 false를 반환한다', () => {
    expect(isIssueBranch('fix/issue-abc')).toBe(false)
  })

  it('docs/issue-1 같은 허용되지 않는 접두사는 false를 반환한다', () => {
    expect(isIssueBranch('docs/issue-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasReviewMarker 테스트
// ---------------------------------------------------------------------------

describe('hasReviewMarker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[자동 PR 리뷰] 마커가 있는 코멘트가 있으면 true를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(
        null,
        JSON.stringify({
          comments: [
            { body: '[자동 PR 리뷰]\n\n## Strategic Review\n...' },
          ],
        }),
      )
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(42)
    expect(result).toBe(true)
  })

  it('마커가 없는 코멘트만 있으면 false를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(
        null,
        JSON.stringify({
          comments: [
            { body: 'LGTM!' },
            { body: '코드 리뷰 부탁드려요' },
          ],
        }),
      )
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(42)
    expect(result).toBe(false)
  })

  it('코멘트가 없으면 false를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(null, JSON.stringify({ comments: [] }))
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(10)
    expect(result).toBe(false)
  })

  it('gh CLI 조회 실패 시 안전하게 true를 반환한다 (스킵 처리)', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: Error, stdout: string) => void
      cb(new Error('gh CLI 실패'), '')
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(99)
    expect(result).toBe(true)
  })

  it('stdout이 빈 문자열이면 false를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(null, '')
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(5)
    expect(result).toBe(false)
  })
})
