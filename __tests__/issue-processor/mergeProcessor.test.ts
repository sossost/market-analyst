import { describe, it, expect, vi, beforeEach } from 'vitest'

// child_process 모킹 — execFile (직접 호출)
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// discordClient 모킹
vi.mock('@/issue-processor/discordClient', () => ({
  sendThreadMessage: vi.fn(),
}))

// prThreadStore 모킹
vi.mock('@/issue-processor/prThreadStore', () => ({
  removePrThreadMapping: vi.fn(),
}))

// logger 모킹
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { execFile } from 'node:child_process'
import { sendThreadMessage } from '@/issue-processor/discordClient'
import { processMerge } from '@/issue-processor/mergeProcessor'
import type { PrThreadMapping } from '@/issue-processor/types'

const mockExecFile = vi.mocked(execFile)
const mockSendThreadMessage = vi.mocked(sendThreadMessage)

const sampleMapping: PrThreadMapping = {
  prNumber: 42,
  threadId: 'thread-123',
  issueNumber: 42,
  branchName: 'fix/issue-42',
  createdAt: '2026-03-20T00:00:00.000Z',
}

/**
 * execFile 모킹 헬퍼 — callback 기반 (stdin 없는 일반 명령)
 */
function mockExecFileCall(
  stdout: string,
  stderr: string = '',
  error: Error | null = null,
): void {
  mockExecFile.mockImplementationOnce(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
      process.nextTick(() => cb(error, stdout, stderr))
      return { stdin: { end: vi.fn() } } as never
    },
  )
}

function mockExecFileError(err: Error): void {
  mockExecFile.mockImplementationOnce(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
      process.nextTick(() => cb(err, '', ''))
      return { stdin: { end: vi.fn() } } as never
    },
  )
}

/**
 * processMerge가 내부적으로 실행하는 gh/git 명령들을 순서대로 mock.
 * processMerge 흐름: fetchPrState → resolveReviewComments (fetchReviewComments + hasChangesRequested) → merge → runPostMergeInfra (fetchMergedFiles) → deleteLocalBranchIfExists
 */
function setupBasicMergeFlow(mergedFiles: Array<{ path: string }>): void {
  // 1. fetchPrState — gh pr view --json state
  mockExecFileCall(JSON.stringify({ state: 'OPEN' }))

  // 2. fetchReviewComments — gh api
  mockExecFileCall('')

  // 3. hasChangesRequested — gh pr view --json reviews
  mockExecFileCall(JSON.stringify({ reviews: [] }))

  // 4. gh pr merge (squash)
  mockExecFileCall('')

  // 5. fetchMergedFiles — gh pr view --json files
  mockExecFileCall(JSON.stringify({ files: mergedFiles }))
}

function setupBasicMergeFlowWithCleanup(mergedFiles: Array<{ path: string }>): void {
  setupBasicMergeFlow(mergedFiles)

  // 6. git checkout main
  mockExecFileCall('')
  // 7. git pull --rebase
  mockExecFileCall('')
  // 8. git branch (로컬 브랜치 목록)
  mockExecFileCall('  main\n')
}

describe('fetchMergedFiles (processMerge 내부 — gh pr view --json files)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gh 응답을 파싱하여 파일 경로 목록을 반환한다', async () => {
    // processMerge를 통해 fetchMergedFiles 동작을 간접 검증
    // gh pr view --json files 응답을 파싱하여 인프라 반영 여부 결정
    setupBasicMergeFlowWithCleanup([
      { path: 'src/db/schema/analyst.ts' },
      { path: 'src/agent/agentLoop.ts' },
    ])

    // applyDbMigration — yarn db:push --force
    mockExecFileCall('')

    await processMerge(sampleMapping)

    // DB 마이그레이션이 트리거됐으면 sendThreadMessage에 'drizzle-kit' 관련 메시지가 포함됨
    const calls = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(calls.some(msg => msg.includes('drizzle-kit'))).toBe(true)
  })

  it('gh 조회 실패 시 인프라 반영을 스킵한다', async () => {
    // fetchPrState
    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    // fetchReviewComments
    mockExecFileCall('')
    // hasChangesRequested
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // gh pr merge
    mockExecFileCall('')
    // fetchMergedFiles — 실패
    mockExecFileError(new Error('gh command failed'))
    // deleteLocalBranchIfExists
    mockExecFileCall('')
    mockExecFileCall('')
    mockExecFileCall('  main\n')

    await processMerge(sampleMapping)

    // DB 마이그레이션 메시지가 없어야 함
    const calls = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(calls.some(msg => msg.includes('drizzle-kit'))).toBe(false)
    expect(calls.some(msg => msg.includes('launchd'))).toBe(false)
  })
})

describe('runPostMergeInfra (processMerge 내부)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('DB 스키마 파일 포함 시 DB 마이그레이션을 실행한다', async () => {
    setupBasicMergeFlowWithCleanup([
      { path: 'src/db/schema/analyst.ts' },
    ])
    // applyDbMigration — yarn db:push --force
    mockExecFileCall('')

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('drizzle-kit'))).toBe(true)
    expect(messages.some(msg => msg.includes('DB 마이그레이션 완료'))).toBe(true)
  })

  it('db/migrations/ 경로 파일 포함 시 DB 마이그레이션을 실행한다', async () => {
    setupBasicMergeFlowWithCleanup([
      { path: 'db/migrations/0001_add_column.sql' },
    ])
    mockExecFileCall('')

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('drizzle-kit'))).toBe(true)
  })

  it('plist 파일 포함 시 launchd 재로드를 실행한다', async () => {
    setupBasicMergeFlowWithCleanup([
      { path: 'scripts/launchd/market-analyst.plist' },
    ])
    // reloadLaunchd — bash setup-launchd.sh
    mockExecFileCall('')

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('launchd'))).toBe(true)
    expect(messages.some(msg => msg.includes('launchd 재로드 완료'))).toBe(true)
  })

  it('DB + plist 파일 둘 다 포함 시 DB 마이그레이션 먼저, launchd 재로드 나중에 실행한다', async () => {
    setupBasicMergeFlowWithCleanup([
      { path: 'src/db/schema/analyst.ts' },
      { path: 'scripts/launchd/market-analyst.plist' },
    ])
    // applyDbMigration
    mockExecFileCall('')
    // reloadLaunchd
    mockExecFileCall('')

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    const dbMigIdx = messages.findIndex(msg => msg.includes('drizzle-kit'))
    const launchdIdx = messages.findIndex(msg => msg.includes('launchd'))

    expect(dbMigIdx).not.toBe(-1)
    expect(launchdIdx).not.toBe(-1)
    // DB가 launchd보다 먼저
    expect(dbMigIdx).toBeLessThan(launchdIdx)
  })

  it('인프라 대상 파일이 없으면 DB 마이그레이션과 launchd 재로드를 실행하지 않는다', async () => {
    setupBasicMergeFlowWithCleanup([
      { path: 'src/agent/agentLoop.ts' },
      { path: 'README.md' },
    ])

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('drizzle-kit'))).toBe(false)
    expect(messages.some(msg => msg.includes('launchd'))).toBe(false)
  })

  it('scripts/launchd/ 경로이지만 .plist가 아니면 launchd 재로드를 실행하지 않는다', async () => {
    setupBasicMergeFlowWithCleanup([
      { path: 'scripts/launchd/setup-launchd.sh' },
    ])

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('launchd 재로드'))).toBe(false)
  })
})

describe('applyDbMigration (processMerge 내부)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  it('실패 시 인프라 반영 실패 알림을 보내고 머지 흐름을 중단한다 (매핑 유지)', async () => {
    // fetchPrState
    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    // fetchReviewComments
    mockExecFileCall('')
    // hasChangesRequested
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // gh pr merge
    mockExecFileCall('')
    // fetchMergedFiles
    mockExecFileCall(JSON.stringify({ files: [{ path: 'src/db/schema/analyst.ts' }] }))
    // applyDbMigration — yarn db:push --force 실패
    mockExecFileError(new Error('drizzle-kit push failed: connection timeout'))
    // processMerge는 인프라 실패 시 return하므로 cleanup mock 불필요

    // processMerge가 예외 없이 완료돼야 함
    await expect(processMerge(sampleMapping)).resolves.toBeUndefined()

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('인프라 반영 실패'))).toBe(true)
    // 머지 완료 알림은 보내지 않는다 (return으로 중단)
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(false)
  })

  it('exit 0 + stderr error: 패턴 → 인프라 반영 실패로 처리한다', async () => {
    // fetchPrState
    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    // fetchReviewComments
    mockExecFileCall('')
    // hasChangesRequested
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // gh pr merge
    mockExecFileCall('')
    // fetchMergedFiles
    mockExecFileCall(JSON.stringify({ files: [{ path: 'src/db/schema/analyst.ts' }] }))
    // applyDbMigration — exit 0이지만 stderr에 error: 포함
    mockExecFileCall('', 'error: relation "analyst" already exists')

    await expect(processMerge(sampleMapping)).resolves.toBeUndefined()

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('인프라 반영 실패'))).toBe(true)
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(false)
  })
})

describe('reloadLaunchd (processMerge 내부)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  it('실패 시 예외를 throw하지 않고 에러 메시지를 스레드에 전송한다', async () => {
    // fetchPrState
    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    // fetchReviewComments
    mockExecFileCall('')
    // hasChangesRequested
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // gh pr merge
    mockExecFileCall('')
    // fetchMergedFiles
    mockExecFileCall(JSON.stringify({ files: [{ path: 'scripts/launchd/market-analyst.plist' }] }))
    // reloadLaunchd — setup-launchd.sh 실패
    mockExecFileError(new Error('setup-launchd.sh: permission denied'))
    // deleteLocalBranchIfExists — git checkout main, pull, branch
    mockExecFileCall('')
    mockExecFileCall('')
    mockExecFileCall('  main\n')

    // processMerge가 예외 없이 완료돼야 함
    await expect(processMerge(sampleMapping)).resolves.toBeUndefined()

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('❌ launchd 재로드 실패'))).toBe(true)
    // 완료 알림도 정상 발송돼야 함
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(true)
  })
})
