/**
 * checkCiStatus.ts — 단위 테스트
 *
 * gh CLI는 vi.mock으로 모킹. 실제 네트워크 호출 없음.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractRunId,
} from '../checkCiStatus.js'

// ---------------------------------------------------------------------------
// node:child_process + node:util 모킹 (findReviewablePrs.test.ts와 동일 패턴)
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  promisify: vi.fn(),
}))

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => {
    return (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        ;(fn as Function)(...args, (err: Error | null, stdout: string, stderr?: string) => {
          if (err != null) {
            reject(err)
          } else {
            resolve({ stdout, stderr: stderr ?? '' })
          }
        })
      })
  },
}))

// ---------------------------------------------------------------------------
// extractRunId
// ---------------------------------------------------------------------------

describe('extractRunId', () => {
  it('GitHub Actions URL에서 run ID를 추출한다', () => {
    expect(
      extractRunId('https://github.com/owner/repo/actions/runs/12345678/job/67890'),
    ).toBe('12345678')
  })

  it('run ID만 있는 URL에서도 추출한다', () => {
    expect(
      extractRunId('https://github.com/owner/repo/actions/runs/99999999'),
    ).toBe('99999999')
  })

  it('Actions URL이 아니면 null을 반환한다', () => {
    expect(extractRunId('https://github.com/owner/repo/pull/42')).toBeNull()
  })

  it('빈 문자열이면 null을 반환한다', () => {
    expect(extractRunId('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchFailedChecks
// ---------------------------------------------------------------------------

describe('fetchFailedChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('실패한 체크만 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(
        null,
        JSON.stringify([
          { name: 'test', state: 'FAIL', link: 'https://example.com/runs/1', description: 'Failed' },
          { name: 'lint', state: 'PASS', link: 'https://example.com/runs/2', description: 'OK' },
          { name: 'build', state: 'FAIL', link: 'https://example.com/runs/3', description: 'Build error' },
        ]),
        '',
      )
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedChecks } = await import('../checkCiStatus.js')
    const result = await fetchFailedChecks(42)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('test')
    expect(result[1].name).toBe('build')
  })

  it('모든 체크가 통과하면 빈 배열을 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(
        null,
        JSON.stringify([
          { name: 'test', state: 'PASS', link: '', description: '' },
        ]),
        '',
      )
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedChecks } = await import('../checkCiStatus.js')
    const result = await fetchFailedChecks(42)
    expect(result).toHaveLength(0)
  })

  it('stdout이 빈 문자열이면 빈 배열을 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(null, '', '')
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedChecks } = await import('../checkCiStatus.js')
    const result = await fetchFailedChecks(42)
    expect(result).toHaveLength(0)
  })

  it('gh CLI 실패 시 throw한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: Error, stdout: string, stderr: string) => void
      cb(new Error('gh CLI 실패'), '', '')
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedChecks } = await import('../checkCiStatus.js')
    await expect(fetchFailedChecks(42)).rejects.toThrow('gh CLI 실패')
  })
})

// ---------------------------------------------------------------------------
// fetchFailedRunLog
// ---------------------------------------------------------------------------

describe('fetchFailedRunLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('실패 로그를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(null, 'Error: test failed at line 42', '')
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedRunLog } = await import('../checkCiStatus.js')
    const log = await fetchFailedRunLog('12345')
    expect(log).toBe('Error: test failed at line 42')
  })

  it('긴 로그는 마지막 2000자로 트런케이션한다', async () => {
    const { execFile } = await import('node:child_process')
    const longLog = 'x'.repeat(3000)
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: null, stdout: string, stderr: string) => void
      cb(null, longLog, '')
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedRunLog } = await import('../checkCiStatus.js')
    const log = await fetchFailedRunLog('12345')
    expect(log).toContain('앞부분 생략')
    // 트런케이션된 로그 + 접두사
    expect(log.length).toBeLessThan(longLog.length)
  })

  it('gh CLI 실패 시 에러 메시지를 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (err: Error, stdout: string, stderr: string) => void
      cb(new Error('gh 실패'), '', '')
      return {} as ReturnType<typeof execFile>
    })

    const { fetchFailedRunLog } = await import('../checkCiStatus.js')
    const log = await fetchFailedRunLog('12345')
    expect(log).toBe('(로그 수집 실패)')
  })
})
