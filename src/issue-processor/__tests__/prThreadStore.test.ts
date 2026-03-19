/**
 * prThreadStore.ts 단위 테스트
 *
 * 파일 I/O는 실제 fs를 사용하되 임시 경로로 격리.
 * 테스트 후 생성된 파일은 정리.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PrThreadMapping } from '../types.js'

// ---------------------------------------------------------------------------
// 임시 파일 경로로 교체 (process.cwd() 모킹)
// ---------------------------------------------------------------------------

const TMP_DIR = path.resolve(process.cwd(), 'data/__test_tmp__')
const TMP_STORE_PATH = path.join(TMP_DIR, 'pr-thread-mappings.json')

// prThreadStore가 STORE_PATH를 process.cwd() 기반으로 만들기 때문에
// 테스트에서는 실제 파일을 직접 조작하여 간접 검증한다.
// 단, prThreadStore 내부의 STORE_PATH를 override하기 위해 파일을 임시 경로에 두고
// 모듈을 다시 import하는 방식 대신 직접 파일을 조작하는 통합 방식 사용.

// 실제 data/pr-thread-mappings.json 경로를 사용하되 테스트 전후에 정리.
const REAL_STORE_PATH = path.resolve(process.cwd(), 'data/pr-thread-mappings.json')

// ---------------------------------------------------------------------------
// 테스트 데이터
// ---------------------------------------------------------------------------

function makeMapping(prNumber: number, threadId: string): PrThreadMapping {
  return {
    prNumber,
    threadId,
    issueNumber: prNumber * 10,
    branchName: `feat/issue-${prNumber * 10}`,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalContent: string | null = null

beforeEach(() => {
  // 기존 파일 내용 백업
  if (fs.existsSync(REAL_STORE_PATH)) {
    originalContent = fs.readFileSync(REAL_STORE_PATH, 'utf-8')
  } else {
    originalContent = null
  }

  // 테스트 시작 전 파일 삭제 (깨끗한 상태)
  if (fs.existsSync(REAL_STORE_PATH)) {
    fs.unlinkSync(REAL_STORE_PATH)
  }
})

afterEach(async () => {
  // 원래 상태로 복원
  if (originalContent != null) {
    fs.mkdirSync(path.dirname(REAL_STORE_PATH), { recursive: true })
    fs.writeFileSync(REAL_STORE_PATH, originalContent, 'utf-8')
  } else {
    if (fs.existsSync(REAL_STORE_PATH)) {
      fs.unlinkSync(REAL_STORE_PATH)
    }
  }
})

// ---------------------------------------------------------------------------
// loadAllMappings
// ---------------------------------------------------------------------------

describe('loadAllMappings', () => {
  it('파일이 없으면 빈 배열을 반환한다', async () => {
    const { loadAllMappings } = await import('../prThreadStore.js')
    const result = loadAllMappings()
    expect(result).toEqual([])
  })

  it('저장된 매핑 목록을 반환한다', async () => {
    const mapping = makeMapping(42, 'thread-abc')
    fs.mkdirSync(path.dirname(REAL_STORE_PATH), { recursive: true })
    fs.writeFileSync(REAL_STORE_PATH, JSON.stringify([mapping]), 'utf-8')

    const { loadAllMappings } = await import('../prThreadStore.js')
    const result = loadAllMappings()

    expect(result).toHaveLength(1)
    expect(result[0].prNumber).toBe(42)
    expect(result[0].threadId).toBe('thread-abc')
  })

  it('파일이 손상된 경우 빈 배열을 반환한다', async () => {
    fs.mkdirSync(path.dirname(REAL_STORE_PATH), { recursive: true })
    fs.writeFileSync(REAL_STORE_PATH, 'INVALID JSON!!!', 'utf-8')

    const { loadAllMappings } = await import('../prThreadStore.js')
    const result = loadAllMappings()
    expect(result).toEqual([])
  })

  it('배열이 아닌 JSON인 경우 빈 배열을 반환한다', async () => {
    fs.mkdirSync(path.dirname(REAL_STORE_PATH), { recursive: true })
    fs.writeFileSync(REAL_STORE_PATH, JSON.stringify({ foo: 'bar' }), 'utf-8')

    const { loadAllMappings } = await import('../prThreadStore.js')
    const result = loadAllMappings()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// savePrThreadMapping
// ---------------------------------------------------------------------------

describe('savePrThreadMapping', () => {
  it('새 매핑을 파일에 저장한다', async () => {
    const { savePrThreadMapping, loadAllMappings } = await import('../prThreadStore.js')

    const mapping = makeMapping(42, 'thread-abc')
    savePrThreadMapping(mapping)

    const result = loadAllMappings()
    expect(result).toHaveLength(1)
    expect(result[0].prNumber).toBe(42)
  })

  it('동일 PR 번호가 있으면 덮어쓴다', async () => {
    const { savePrThreadMapping, loadAllMappings } = await import('../prThreadStore.js')

    const mapping1 = makeMapping(42, 'thread-abc')
    const mapping2 = { ...makeMapping(42, 'thread-xyz'), issueNumber: 420 }

    savePrThreadMapping(mapping1)
    savePrThreadMapping(mapping2)

    const result = loadAllMappings()
    expect(result).toHaveLength(1)
    expect(result[0].threadId).toBe('thread-xyz')
    expect(result[0].issueNumber).toBe(420)
  })

  it('서로 다른 PR 번호는 별도로 저장된다', async () => {
    const { savePrThreadMapping, loadAllMappings } = await import('../prThreadStore.js')

    savePrThreadMapping(makeMapping(42, 'thread-abc'))
    savePrThreadMapping(makeMapping(43, 'thread-def'))

    const result = loadAllMappings()
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// findMappingByPrNumber
// ---------------------------------------------------------------------------

describe('findMappingByPrNumber', () => {
  it('PR 번호로 매핑을 조회한다', async () => {
    const { savePrThreadMapping, findMappingByPrNumber } = await import('../prThreadStore.js')

    savePrThreadMapping(makeMapping(42, 'thread-abc'))
    savePrThreadMapping(makeMapping(43, 'thread-def'))

    const result = findMappingByPrNumber(42)
    expect(result).not.toBeNull()
    expect(result?.threadId).toBe('thread-abc')
  })

  it('없는 PR 번호 조회 시 null을 반환한다', async () => {
    const { findMappingByPrNumber } = await import('../prThreadStore.js')

    const result = findMappingByPrNumber(9999)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateLastScannedMessageId
// ---------------------------------------------------------------------------

describe('updateLastScannedMessageId', () => {
  it('lastScannedMessageId를 갱신한다', async () => {
    const { savePrThreadMapping, updateLastScannedMessageId, loadAllMappings } =
      await import('../prThreadStore.js')

    savePrThreadMapping(makeMapping(42, 'thread-abc'))
    updateLastScannedMessageId(42, 'msg-999')

    const mappings = loadAllMappings()
    expect(mappings[0].lastScannedMessageId).toBe('msg-999')
  })

  it('존재하지 않는 PR 번호면 아무 변화 없이 경고만 남긴다', async () => {
    const { updateLastScannedMessageId, loadAllMappings } = await import('../prThreadStore.js')

    // 에러를 throw하지 않아야 함
    expect(() => updateLastScannedMessageId(9999, 'msg-1')).not.toThrow()
    expect(loadAllMappings()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// removePrThreadMapping
// ---------------------------------------------------------------------------

describe('removePrThreadMapping', () => {
  it('PR 번호로 매핑을 삭제한다', async () => {
    const { savePrThreadMapping, removePrThreadMapping, loadAllMappings } =
      await import('../prThreadStore.js')

    savePrThreadMapping(makeMapping(42, 'thread-abc'))
    savePrThreadMapping(makeMapping(43, 'thread-def'))

    removePrThreadMapping(42)

    const result = loadAllMappings()
    expect(result).toHaveLength(1)
    expect(result[0].prNumber).toBe(43)
  })

  it('없는 PR 번호 삭제 시 에러 없이 처리한다', async () => {
    const { removePrThreadMapping } = await import('../prThreadStore.js')

    expect(() => removePrThreadMapping(9999)).not.toThrow()
  })
})
