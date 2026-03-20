# 이슈 프로세서: Post-Merge 인프라 자동 반영

## 선행 맥락

- **사고 #1 (PR #295)**: `minority_view` 컬럼 추가 PR이 머지됐지만 DB 마이그레이션 미적용 → 토론 에이전트 3일 연속 실패. `src/db/schema/analyst.ts` 변경이 감지되지 않아 발생.
- **사고 #2**: `scripts/launchd/*.plist` 변경 PR 머지 후 launchctl reload 미실행 → 스케줄 변경 미반영. `feedback_launchd_reload.md`에 수동 절차로만 기록됨.
- **현재 mergeProcessor.ts 흐름**: squash merge → 로컬 브랜치 정리(checkout main + pull + branch -d) → Discord 완료 알림 → 매핑 삭제. 머지 후 인프라 반영 단계 없음.
- **마이그레이션 도구**: `drizzle-kit push` (`yarn db:push`). supabase CLI 미설치. Supabase MCP는 CLI 환경 불가.
- **launchd 재로드**: `setup-launchd.sh`(unload + load)가 이미 존재. 그대로 재호출하면 됨.
- **PR 변경 파일 조회**: `gh pr view {prNumber} --json files` — `files[].path`로 변경된 파일 경로 목록 취득 가능.

## 골 정렬

**SUPPORT** — 머지 후 인프라 불일치 방지. 토론 에이전트·스케줄러 장애를 근본 차단하여 Phase 2 포착 파이프라인의 안정성 보장.

## 문제

`mergeProcessor`가 PR을 머지한 뒤 인프라 반영을 하지 않는다. DB 스키마 변경이나 plist 변경이 포함된 PR이 머지되면 수동 조작이 필요하고, 누락 시 파이프라인 장애로 이어진다.

## Before → After

**Before**
- PR #295처럼 DB 스키마 변경 PR 머지 → 수동으로 `yarn db:push` 실행해야 함 → 누락 시 에이전트 크래시
- plist 변경 PR 머지 → 수동으로 `setup-launchd.sh` 재실행해야 함 → 누락 시 스케줄 미반영

**After**
- `src/db/schema/` 또는 `db/migrations/` 파일이 포함된 PR 머지 → `yarn db:push` 자동 실행 + 결과를 Discord 스레드에 보고
- `scripts/launchd/*.plist` 파일이 포함된 PR 머지 → `setup-launchd.sh` 자동 재실행 + 결과를 Discord 스레드에 보고

## 변경 사항

### 수정 파일 1개

**`src/issue-processor/mergeProcessor.ts`**

현재 `processMerge()` 흐름의 3번(squash merge)과 4번(로컬 브랜치 정리) 사이에 단계를 추가:

```
3. squash merge 실행
3.5. [신규] post-merge 인프라 반영 (runPostMergeInfra)
4. 로컬 브랜치 정리
5. Discord 완료 알림
6. 매핑 삭제
```

### 추가 함수 (mergeProcessor.ts 내부)

```typescript
// PR 머지 후 변경된 파일 목록 조회
async function fetchMergedFiles(prNumber: number): Promise<string[]>

// 변경 파일 기반 인프라 반영 결정 + 실행
async function runPostMergeInfra(prNumber: number, threadId: string): Promise<void>

// DB 마이그레이션 적용 (yarn db:push)
async function applyDbMigration(threadId: string): Promise<void>

// launchd 재로드 (setup-launchd.sh)
async function reloadLaunchd(threadId: string): Promise<void>
```

### 감지 규칙

```typescript
const DB_SCHEMA_PATTERNS = [
  'src/db/schema/',
  'db/migrations/',
]

const LAUNCHD_PATTERN = 'scripts/launchd/'
```

- 변경 파일 경로 중 하나라도 `DB_SCHEMA_PATTERNS` 접두사를 가지면 → `applyDbMigration` 실행
- 변경 파일 경로 중 하나라도 `LAUNCHD_PATTERN` 접두사를 가지고 `.plist` 확장자이면 → `reloadLaunchd` 실행
- 두 조건이 동시에 참이면 순서대로 실행 (DB 먼저, launchd 나중)
- 둘 다 해당 없으면 스킵 (로그만 남기고 조용히 통과)

## 작업 계획

### Phase 1: 변경 파일 조회 함수

**담당**: 구현팀

`fetchMergedFiles(prNumber)` 구현:
```typescript
const raw = await gh(['pr', 'view', String(prNumber), '--json', 'files'])
const data = JSON.parse(raw) as { files: Array<{ path: string }> }
return data.files.map(f => f.path)
```

**완료 기준**: `gh pr view --json files`로 변경 파일 목록 반환, PR 조회 실패 시 빈 배열 반환(에러 삼킴).

### Phase 2: DB 마이그레이션 적용

**담당**: 구현팀

`applyDbMigration(threadId)` 구현:

```typescript
await sendThreadMessage(threadId, 'DB 스키마 변경 감지 — drizzle-kit push 실행 중...')
await execFileP('yarn', ['db:push', '--force'], {
  timeout: 120_000,
  cwd: process.cwd(),
  env: process.env,
})
await sendThreadMessage(threadId, 'DB 마이그레이션 완료.')
```

- `--force` 플래그: 대화형 프롬프트 없이 강제 적용 (자동화 환경 필수)
- 타임아웃: 120초 (Supabase 네트워크 레이턴시 여유)
- 실패 시: 스레드에 에러 메시지 발송 + `send_error` 패턴으로 Discord 에러 채널 알림. 단, 에러가 `processMerge` 전체를 중단시키지는 않음 — 브랜치 정리와 완료 알림은 계속 진행.

**완료 기준**: `src/db/schema/analyst.ts` 변경 PR 머지 시 `yarn db:push --force` 자동 실행, 결과가 Discord 스레드에 보고됨.

### Phase 3: launchd 재로드

**담당**: 구현팀

`reloadLaunchd(threadId)` 구현:

```typescript
await sendThreadMessage(threadId, 'plist 변경 감지 — launchd 재로드 중...')
await execFileP('bash', ['scripts/launchd/setup-launchd.sh'], {
  timeout: 30_000,
  cwd: process.cwd(),
  env: process.env,
})
await sendThreadMessage(threadId, 'launchd 재로드 완료.')
```

- `setup-launchd.sh`가 이미 unload → copy → load 순서를 처리하므로 그대로 재활용
- 실패 시: 스레드에 에러 발송. 마찬가지로 `processMerge` 중단 없음.

**완료 기준**: `scripts/launchd/*.plist` 변경 PR 머지 시 `setup-launchd.sh` 자동 실행, Discord 스레드에 결과 보고됨.

### Phase 4: 오케스트레이터 통합

**담당**: 구현팀

`runPostMergeInfra(prNumber, threadId)` 구현 + `processMerge` 내 3.5 단계에 삽입:

```typescript
async function runPostMergeInfra(prNumber: number, threadId: string): Promise<void> {
  let files: string[]
  try {
    files = await fetchMergedFiles(prNumber)
  } catch {
    logger.warn(TAG, `PR #${prNumber} 변경 파일 조회 실패 — 인프라 반영 스킵`)
    return
  }

  const needsDbMigration = files.some(
    f => DB_SCHEMA_PATTERNS.some(pattern => f.startsWith(pattern))
  )
  const needsLaunchdReload = files.some(
    f => f.startsWith(LAUNCHD_PATTERN) && f.endsWith('.plist')
  )

  if (!needsDbMigration && !needsLaunchdReload) {
    logger.info(TAG, `PR #${prNumber}: 인프라 반영 대상 없음 — 스킵`)
    return
  }

  if (needsDbMigration) {
    await applyDbMigration(threadId)
  }
  if (needsLaunchdReload) {
    await reloadLaunchd(threadId)
  }
}
```

`processMerge` 내 위치:
```typescript
// 3. squash merge 실행
await gh(['pr', 'merge', String(prNumber), '--squash', '--delete-branch'])

// 3.5. post-merge 인프라 반영
await runPostMergeInfra(prNumber, threadId)  // 실패해도 계속 진행

// 4. 로컬 브랜치 정리
await deleteLocalBranchIfExists(branchName)
```

**완료 기준**: DB+launchd 둘 다 감지 시 순서대로 실행됨. 인프라 반영 실패가 브랜치 정리·완료 알림을 막지 않음.

### Phase 5: 테스트

**담당**: 구현팀

`__tests__/issue-processor/mergeProcessor.test.ts` 추가 케이스:

- `fetchMergedFiles`: gh 응답 파싱 정상 동작, 실패 시 빈 배열
- `runPostMergeInfra`:
  - DB 스키마 파일 포함 → `applyDbMigration` 호출됨
  - plist 파일 포함 → `reloadLaunchd` 호출됨
  - 둘 다 포함 → 둘 다 호출됨 (DB 먼저)
  - 해당 없음 → 둘 다 호출 안 됨
  - `fetchMergedFiles` 실패 → 경고 로그만, 인프라 반영 스킵
- `applyDbMigration` 실패 → 스레드에 에러 알림 발송, 예외 throw 안 함
- `reloadLaunchd` 실패 → 스레드에 에러 알림 발송, 예외 throw 안 함

**완료 기준**: 신규 테스트 케이스 전부 통과, 기존 `processMerge` 테스트 깨지지 않음.

## 리스크

| 리스크 | 대응 |
|--------|------|
| `drizzle-kit push --force`가 스키마 삭제 컬럼을 드롭할 수 있음 | Supabase에서 컬럼 추가/변경은 안전. 삭제 포함 마이그레이션은 PR 시점에 이미 검토됨. 프로덕션 운영 중이므로 삭제 컬럼 마이그레이션 자체를 지양하는 것이 방어선. |
| `yarn db:push` 타임아웃 (Supabase 느린 응답) | 120초로 여유 부여. 초과 시 에러 알림 + 스킵. |
| `gh pr view --json files`가 squash merge 직후 files를 못 가져오는 경우 | squash merge 후 PR 상태는 MERGED이고 files는 유지됨. 실패 시 빈 배열 → 인프라 스킵(로그 기록). |
| launchd reload 중 실행 중인 스케줄 잡 중단 | setup-launchd.sh가 unload → load 순서. 실행 중인 잡은 unload 시 kill됨. 머지는 보통 업무 시간에 일어나므로 새벽 배치와 충돌 가능성 낮음. 허용 가능한 트레이드오프. |

## 의사결정 필요

없음 — 요구사항이 이슈 #331에서 명확히 확정됨. 감지 조건과 후속 작업이 모두 지정됨.
