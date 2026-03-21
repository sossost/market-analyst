/**
 * holdGate.ts — 단위 테스트
 *
 * parseStrategicVerdict: 출력 파싱 케이스 검증
 * applyHoldGate: HOLD/REJECT 후처리 (gh CLI mock)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('../../issue-processor/prThreadStore.js', () => ({
  removePrThreadMapping: vi.fn(),
}))

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

import { execFile as execFileNode } from 'node:child_process'

type ExecFileType = typeof execFileNode

/** execFile을 성공 응답으로 설정 */
async function setupExecFileAsSuccess(): Promise<void> {
  const { execFile } = await import('node:child_process')
  vi.mocked(execFile).mockImplementation(
    (_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, '', '')
      return { stdin: null } as unknown as ReturnType<ExecFileType>
    },
  )
}

/** execFile을 에러 응답으로 설정 */
async function setupExecFileAsError(message: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  vi.mocked(execFile).mockImplementation(
    (_cmd, _args, _options, callback) => {
      const cb = callback as (error: Error, stdout: string, stderr: string) => void
      cb(new Error(message), '', '')
      return { stdin: null } as unknown as ReturnType<ExecFileType>
    },
  )
}

// ---------------------------------------------------------------------------
// parseStrategicVerdict 테스트
// ---------------------------------------------------------------------------

describe('parseStrategicVerdict', () => {
  it('PROCEED 판정을 파싱한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '### Strategic Review\n\n골 정렬: ALIGNED\n종합: PROCEED\n\n**사유**\n이슈를 충족함.'
    expect(parseStrategicVerdict(output)).toBe('PROCEED')
  })

  it('HOLD 판정을 파싱한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '### Strategic Review\n\n골 정렬: NEUTRAL\n종합: HOLD\n\n**사유**\n방향 재검토 필요.'
    expect(parseStrategicVerdict(output)).toBe('HOLD')
  })

  it('REJECT 판정을 파싱한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '### Strategic Review\n\n골 정렬: MISALIGNED\n종합: REJECT\n\n**사유**\n골 미정렬.'
    expect(parseStrategicVerdict(output)).toBe('REJECT')
  })

  it('종합: 앞뒤 공백이 있어도 파싱한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '종합:  HOLD'
    expect(parseStrategicVerdict(output)).toBe('HOLD')
  })

  it('종합 라인이 없으면 null을 반환한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '### Strategic Review\n\n골 정렬: ALIGNED\n\n**사유**\n분석 내용.'
    expect(parseStrategicVerdict(output)).toBeNull()
  })

  it('빈 문자열이면 null을 반환한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    expect(parseStrategicVerdict('')).toBeNull()
  })

  it('종합 값이 유효하지 않은 문자열이면 null을 반환한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '종합: UNKNOWN'
    expect(parseStrategicVerdict(output)).toBeNull()
  })

  it('종합 라인이 줄 중간에 있어도 멀티라인 플래그로 파싱한다', async () => {
    const { parseStrategicVerdict } = await import('../holdGate.js')
    const output = '앞줄 내용\n종합: REJECT\n뒷줄 내용'
    expect(parseStrategicVerdict(output)).toBe('REJECT')
  })
})

// ---------------------------------------------------------------------------
// applyHoldGate 테스트
// ---------------------------------------------------------------------------

describe('applyHoldGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PROCEED 판정이면 아무것도 실행하지 않는다', async () => {
    await setupExecFileAsSuccess()
    const { execFile } = await import('node:child_process')
    const { removePrThreadMapping } = await import('../../issue-processor/prThreadStore.js')
    const { applyHoldGate } = await import('../holdGate.js')

    await applyHoldGate(42, 'PROCEED')

    expect(execFile).not.toHaveBeenCalled()
    expect(removePrThreadMapping).not.toHaveBeenCalled()
  })

  it('HOLD 판정 시 Draft 전환 → 라벨 부착 → 매핑 제거 순으로 실행한다', async () => {
    const calls: string[] = []
    const { execFile } = await import('node:child_process')
    const { removePrThreadMapping } = await import('../../issue-processor/prThreadStore.js')

    vi.mocked(execFile).mockImplementation(
      (_cmd, args, _options, callback) => {
        const argList = args as string[]
        calls.push(argList.join(' '))
        const cb = callback as (error: null, stdout: string, stderr: string) => void
        cb(null, '', '')
        return { stdin: null } as unknown as ReturnType<ExecFileType>
      },
    )

    vi.mocked(removePrThreadMapping).mockImplementation((prNumber) => {
      calls.push(`removePrThreadMapping(${prNumber})`)
    })

    const { applyHoldGate } = await import('../holdGate.js')
    await applyHoldGate(42, 'HOLD')

    expect(calls[0]).toContain('pr ready 42 --undo')
    expect(calls[1]).toContain('pr edit 42 --add-label auto:blocked')
    expect(calls[2]).toBe('removePrThreadMapping(42)')
  })

  it('REJECT 판정 시 HOLD와 동일하게 처리한다', async () => {
    await setupExecFileAsSuccess()
    const { removePrThreadMapping } = await import('../../issue-processor/prThreadStore.js')
    const { applyHoldGate } = await import('../holdGate.js')

    await applyHoldGate(99, 'REJECT')

    expect(removePrThreadMapping).toHaveBeenCalledWith(99)
  })

  it('Draft 전환 실패 시 에러 로그 후 라벨 부착과 매핑 제거를 계속 진행한다', async () => {
    const { execFile } = await import('node:child_process')
    const { removePrThreadMapping } = await import('../../issue-processor/prThreadStore.js')

    let callCount = 0
    vi.mocked(execFile).mockImplementation(
      (_cmd, _args, _options, callback) => {
        callCount++
        const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
        if (callCount === 1) {
          // Draft 전환 실패
          cb(new Error('Draft 전환 실패'), '', '')
        } else {
          // 라벨 부착 성공
          cb(null, '', '')
        }
        return { stdin: null } as unknown as ReturnType<ExecFileType>
      },
    )

    const { applyHoldGate } = await import('../holdGate.js')
    await expect(applyHoldGate(42, 'HOLD')).resolves.not.toThrow()

    // 라벨 부착도 호출됨
    expect(execFile).toHaveBeenCalledTimes(2)
    // 매핑 제거도 호출됨
    expect(removePrThreadMapping).toHaveBeenCalledWith(42)
  })

  it('라벨 부착 실패 시 에러 로그 후 매핑 제거를 계속 진행한다', async () => {
    const { execFile } = await import('node:child_process')
    const { removePrThreadMapping } = await import('../../issue-processor/prThreadStore.js')

    let callCount = 0
    vi.mocked(execFile).mockImplementation(
      (_cmd, _args, _options, callback) => {
        callCount++
        const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
        if (callCount === 2) {
          // 라벨 부착 실패
          cb(new Error('라벨 부착 실패'), '', '')
        } else {
          cb(null, '', '')
        }
        return { stdin: null } as unknown as ReturnType<ExecFileType>
      },
    )

    const { applyHoldGate } = await import('../holdGate.js')
    await expect(applyHoldGate(42, 'HOLD')).resolves.not.toThrow()

    // 매핑 제거도 호출됨
    expect(removePrThreadMapping).toHaveBeenCalledWith(42)
  })

  it('모든 단계 실패 시에도 예외를 던지지 않는다', async () => {
    await setupExecFileAsError('gh 실패')
    const { removePrThreadMapping } = await import('../../issue-processor/prThreadStore.js')
    vi.mocked(removePrThreadMapping).mockImplementation(() => {
      throw new Error('매핑 제거 실패')
    })

    const { applyHoldGate } = await import('../holdGate.js')
    await expect(applyHoldGate(42, 'HOLD')).resolves.not.toThrow()
  })
})
