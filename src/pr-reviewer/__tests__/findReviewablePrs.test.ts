/**
 * findReviewablePrs.ts — 단위 테스트
 *
 * gh CLI는 vi.mock으로 모킹. 실제 네트워크 호출 없음.
 * promisify(execFile) 기반이므로 콜백 방식으로 mock한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasReviewMarker } from '../findReviewablePrs.js'

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
// hasReviewMarker 테스트
// ---------------------------------------------------------------------------

describe('hasReviewMarker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[자동 PR 리뷰] 마커가 있는 리뷰가 있으면 true를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(
        null,
        JSON.stringify({
          reviews: [
            { body: '[자동 PR 리뷰]\n\n## Strategic Review\n...', state: 'COMMENTED' },
          ],
        }),
      )
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(42)
    expect(result).toBe(true)
  })

  it('마커가 없는 리뷰만 있으면 false를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(
        null,
        JSON.stringify({
          reviews: [
            { body: 'LGTM!', state: 'APPROVED' },
            { body: '코드 리뷰 부탁드려요', state: 'COMMENTED' },
          ],
        }),
      )
      return {} as ReturnType<typeof execFile>
    })

    const result = await hasReviewMarker(42)
    expect(result).toBe(false)
  })

  it('리뷰가 없으면 false를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string) => void
      cb(null, JSON.stringify({ reviews: [] }))
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
