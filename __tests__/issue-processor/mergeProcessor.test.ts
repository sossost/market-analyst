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

// node:fs/promises 모킹 — reloadPlist가 plist 파일을 읽고 쓸 때 실제 파일시스템에 의존하지 않도록
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('<?xml version="1.0"?><plist><dict><key>Label</key><string>__PROJECT_DIR__</string></dict></plist>'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

// checkCiStatus 모킹 — fetchFailedChecks 기본값: CI 통과 (빈 배열)
vi.mock('@/pr-reviewer/checkCiStatus', () => ({
  fetchFailedChecks: vi.fn().mockResolvedValue([]),
  fetchFailedRunLog: vi.fn().mockResolvedValue('(테스트 에러 로그)'),
  extractRunId: vi.fn().mockReturnValue('run-123'),
}))

import { execFile } from 'node:child_process'
import { sendThreadMessage } from '@/issue-processor/discordClient'
import { fetchFailedChecks } from '@/pr-reviewer/checkCiStatus'
import { processMerge } from '@/issue-processor/mergeProcessor'
import type { PrThreadMapping } from '@/issue-processor/types'

const mockExecFile = vi.mocked(execFile)
const mockSendThreadMessage = vi.mocked(sendThreadMessage)
const mockFetchFailedChecks = vi.mocked(fetchFailedChecks)

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
 * processMerge 흐름:
 *   fetchPrState → resolveReviewComments (fetchReviewComments + hasChangesRequested)
 *   → merge → checkoutAndPullMain → runPostMergeInfra (fetchMergedFiles)
 *   → deleteLocalBranchIfExists
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

  // 5. checkoutAndPullMain — git checkout main
  mockExecFileCall('')
  // 6. checkoutAndPullMain — git fetch origin main
  mockExecFileCall('')
  // 7. checkoutAndPullMain — git reset --hard origin/main
  mockExecFileCall('')

  // 8. fetchMergedFiles — gh pr view --json files
  mockExecFileCall(JSON.stringify({ files: mergedFiles }))
}

function setupBasicMergeFlowWithCleanup(mergedFiles: Array<{ path: string }>): void {
  setupBasicMergeFlow(mergedFiles)

  // 9. deleteLocalBranchIfExists — git branch (로컬 브랜치 목록)
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
    // checkoutAndPullMain — git checkout main + git fetch + git reset --hard
    mockExecFileCall('')
    mockExecFileCall('')
    mockExecFileCall('')
    // fetchMergedFiles — 실패
    mockExecFileError(new Error('gh command failed'))
    // deleteLocalBranchIfExists — git branch
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
    // reloadPlist: launchctl unload + launchctl load
    mockExecFileCall('')
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
    // applyDbMigration — yarn db:push
    mockExecFileCall('')
    // reloadPlist: launchctl unload + launchctl load
    mockExecFileCall('')
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
    mockFetchFailedChecks.mockResolvedValue([])
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
    // checkoutAndPullMain — git checkout main + git fetch + git reset --hard
    mockExecFileCall('')
    mockExecFileCall('')
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
    // checkoutAndPullMain — git checkout main + git fetch + git reset --hard
    mockExecFileCall('')
    mockExecFileCall('')
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
    mockFetchFailedChecks.mockResolvedValue([])
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
    // checkoutAndPullMain — git checkout main + git fetch + git reset --hard
    mockExecFileCall('')
    mockExecFileCall('')
    mockExecFileCall('')
    // fetchMergedFiles
    mockExecFileCall(JSON.stringify({ files: [{ path: 'scripts/launchd/market-analyst.plist' }] }))
    // reloadPlist — launchctl unload (성공)
    mockExecFileCall('')
    // reloadPlist — launchctl load (실패)
    mockExecFileError(new Error('launchctl: permission denied'))
    // deleteLocalBranchIfExists — git branch
    mockExecFileCall('  main\n')

    // processMerge가 예외 없이 완료돼야 함
    await expect(processMerge(sampleMapping)).resolves.toBeUndefined()

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('❌ launchd 재로드 실패'))).toBe(true)
    // 완료 알림도 정상 발송돼야 함
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(true)
  })
})

describe('checkoutAndPullMain 실행 순서 (processMerge 내부)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
    mockFetchFailedChecks.mockResolvedValue([])
  })

  it('checkoutAndPullMain이 runPostMergeInfra보다 먼저 실행된다', async () => {
    const callOrder: string[] = []

    // execFile 호출을 가로채서 실행 순서를 기록
    const calls = [
      // 1. fetchPrState
      { stdout: JSON.stringify({ state: 'OPEN' }), label: 'fetchPrState' },
      // 2. fetchReviewComments
      { stdout: '', label: 'fetchReviewComments' },
      // 3. hasChangesRequested
      { stdout: JSON.stringify({ reviews: [] }), label: 'hasChangesRequested' },
      // 4. gh pr merge
      { stdout: '', label: 'merge' },
      // 5. checkoutAndPullMain — git checkout main
      { stdout: '', label: 'git-checkout-main' },
      // 6. checkoutAndPullMain — git fetch origin main
      { stdout: '', label: 'git-fetch' },
      // 7. checkoutAndPullMain — git reset --hard origin/main
      { stdout: '', label: 'git-reset-hard' },
      // 8. fetchMergedFiles (DB 스키마 포함)
      { stdout: JSON.stringify({ files: [{ path: 'src/db/schema/analyst.ts' }] }), label: 'fetchMergedFiles' },
      // 9. applyDbMigration — yarn db:push
      { stdout: '', label: 'db-push' },
      // 10. deleteLocalBranchIfExists — git branch
      { stdout: '  main\n', label: 'git-branch-list' },
    ]

    for (const { stdout, label } of calls) {
      mockExecFile.mockImplementationOnce(
        (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
          callOrder.push(label)
          const cb = callback as (error: Error | null, stdout: string, stderr: string) => void
          process.nextTick(() => cb(null, stdout, ''))
          return { stdin: { end: vi.fn() } } as never
        },
      )
    }

    await processMerge(sampleMapping)

    // git checkout/fetch/reset이 fetchMergedFiles(인프라 판단)보다 먼저 실행되어야 함
    const checkoutIdx = callOrder.indexOf('git-checkout-main')
    const resetIdx = callOrder.indexOf('git-reset-hard')
    const fetchFilesIdx = callOrder.indexOf('fetchMergedFiles')
    const dbPushIdx = callOrder.indexOf('db-push')

    expect(checkoutIdx).toBeLessThan(fetchFilesIdx)
    expect(resetIdx).toBeLessThan(fetchFilesIdx)
    expect(resetIdx).toBeLessThan(dbPushIdx)
  })

  it('checkoutAndPullMain 실패 시 runPostMergeInfra가 실행되지 않는다', async () => {
    // fetchPrState
    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    // fetchReviewComments
    mockExecFileCall('')
    // hasChangesRequested
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // gh pr merge
    mockExecFileCall('')
    // checkoutAndPullMain — git checkout main 실패
    mockExecFileError(new Error('fatal: cannot checkout main'))
    // processMerge는 checkout 실패 시 return하므로 이후 mock 불필요

    await expect(processMerge(sampleMapping)).resolves.toBeUndefined()

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    // 동기화 실패 알림이 있어야 함
    expect(messages.some(msg => msg.includes('로컬 main 동기화 실패'))).toBe(true)
    // DB 마이그레이션이 실행되지 않아야 함
    expect(messages.some(msg => msg.includes('drizzle-kit'))).toBe(false)
    // 머지 완료 알림도 없어야 함
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(false)
  })
})

describe('CI 게이트 (processMerge 내부)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
    mockFetchFailedChecks.mockResolvedValue([])
  })

  it('CI 통과 시 그대로 머지를 진행한다', async () => {
    mockFetchFailedChecks.mockResolvedValue([])
    setupBasicMergeFlowWithCleanup([])

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(true)
    expect(messages.some(msg => msg.includes('CI 실패 감지'))).toBe(false)
  })

  it('CI 실패 → 수정 CLI 성공 → CI 재통과 → 머지 진행', async () => {
    vi.useFakeTimers()

    // 첫 번째 호출: CI 실패, 이후: CI 통과
    mockFetchFailedChecks
      .mockResolvedValueOnce([{ name: 'test', link: 'https://github.com/owner/repo/actions/runs/123/job/456', description: 'test failed' }])
      .mockResolvedValue([])

    // fetchPrState, fetchReviewComments, hasChangesRequested
    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    mockExecFileCall('')
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // fixCiBranchInPlace — Claude CLI (stdin 기반)
    mockExecFileCall('')
    // gh pr merge
    mockExecFileCall('')
    // checkoutAndPullMain
    mockExecFileCall('')
    mockExecFileCall('')
    mockExecFileCall('')
    // fetchMergedFiles
    mockExecFileCall(JSON.stringify({ files: [] }))
    // deleteLocalBranchIfExists
    mockExecFileCall('  main\n')

    const mergePromise = processMerge(sampleMapping)
    await vi.runAllTimersAsync()
    await mergePromise

    vi.useRealTimers()

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('CI 실패 감지'))).toBe(true)
    expect(messages.some(msg => msg.includes('CI 수정 완료'))).toBe(true)
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(true)
  }, 15_000)

  it('CI 실패 → 수정 CLI 실패 → 머지 중단', async () => {
    mockFetchFailedChecks.mockResolvedValue([
      { name: 'test', link: 'https://github.com/owner/repo/actions/runs/123/job/456', description: 'test failed' },
    ])

    mockExecFileCall(JSON.stringify({ state: 'OPEN' }))
    mockExecFileCall('')
    mockExecFileCall(JSON.stringify({ reviews: [] }))
    // fixCiBranchInPlace — Claude CLI 실패
    mockExecFileError(new Error('claude: ENOENT'))

    await processMerge(sampleMapping)

    const messages = mockSendThreadMessage.mock.calls.map(c => c[1])
    expect(messages.some(msg => msg.includes('CI 수정 실패'))).toBe(true)
    expect(messages.some(msg => msg.includes('머지되었습니다'))).toBe(false)
  })
})
