# mergeProcessor DB 마이그레이션 보고 구조적 개선

GitHub 이슈: #524

## 선행 맥락

없음. 유사 사례 메모리 기록 없음.

## 골 정렬

SUPPORT — 직접 알파 포착 기능은 아니지만, 마이그레이션 오보고는 DB 스키마 불일치 → 런타임 에러 → 파이프라인 침묵 실패로 이어진다. 시스템 신뢰성 인프라.

## 문제

`applyDbMigration()`이 `yarn db:push --force`의 exit code만 확인하고 stdout/stderr를 읽지 않아, exit code 0이어도 실제 DB 에러가 발생한 경우를 놓친다. 또한 마이그레이션 실패해도 non-blocking으로 머지가 계속 진행되어 "완료" 오보고가 발생한다.

## Before → After

**Before**
- `applyDbMigration()`: exit code 0 → 무조건 "완료" 보고. stderr의 `error:` 패턴 무시.
- 마이그레이션 실패 시: try/catch로 잡아서 에러 알림 후 조용히 return. 머지는 계속 진행.
- `runPostMergeInfra()`: `applyDbMigration()` 결과와 무관하게 흐름 계속.

**After**
- `applyDbMigration()`: exit code 0이어도 stdout+stderr에 `error:` 패턴 있으면 throw.
- 마이그레이션 실패 시: `runPostMergeInfra()`에서 throw → `processMerge()`가 catch하여 스레드 알림 후 중단.
- 머지 자체는 이미 완료됐으므로 매핑 삭제는 하지 않음 (다음 세션에서 상태 확인 가능).

## 변경 사항

### 1. `applyDbMigration()` — stderr 에러 감지

현재:
```typescript
async function applyDbMigration(threadId: string): Promise<void> {
  try {
    await execFileP('yarn', ['db:push', '--force'], { ... })
    logger.info(TAG, 'DB 마이그레이션 완료')
    await sendThreadMessage(threadId, '✅ DB 마이그레이션 완료')
  } catch (err) {
    // 실패 알림 후 조용히 종료
  }
}
```

변경: `execFileP`가 stdout과 stderr를 함께 반환하도록 수정하거나, 별도 래퍼로 출력물 획득 후 `error:` 패턴 검사. 에러 감지 시 throw.

구체적 접근:
- `execFileP`의 반환 타입을 `string` → `{ stdout: string; stderr: string }`으로 변경하되, 기존 호출부(`gh`, `git` 헬퍼)는 `.stdout`만 사용하므로 영향 최소화.
- 또는 `applyDbMigration` 내에서만 `execFile`을 직접 호출하여 stdout+stderr를 수집.

**결정**: `execFileP`의 시그니처 변경 범위가 크다. `applyDbMigration` 내부에서만 별도 Promise로 stdout+stderr를 함께 캡처하는 방식으로 격리. 기존 `execFileP`는 변경하지 않는다.

에러 판정 조건:
```
stdout 또는 stderr에 /error:/i 패턴이 포함된 경우
```

### 2. `applyDbMigration()` — throw로 변경

현재 try/catch 내부에서 조용히 return.
변경: 내부 try/catch를 제거하고 에러를 throw. 호출부(`runPostMergeInfra`)가 책임진다.

### 3. `runPostMergeInfra()` — DB 실패 시 throw

현재: `applyDbMigration()` 실패가 `runPostMergeInfra` 레벨의 흐름에 영향을 주지 않음.
변경: `applyDbMigration()` 실패 시 `runPostMergeInfra`가 에러를 re-throw.

단, launchd 재로드는 여전히 non-blocking으로 유지 — launchd 실패는 DB 실패와 달리 런타임 크리티컬이 아님.

### 4. `processMerge()` — `runPostMergeInfra` 실패 처리

현재: `runPostMergeInfra`를 await만 하고 try/catch 없음.
변경: try/catch로 감싸서 실패 시 스레드 알림 + return.

```typescript
// 3.5. Post-merge 인프라 반영
try {
  await runPostMergeInfra(prNumber, threadId)
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err)
  logger.error(TAG, `PR #${prNumber} 인프라 반영 실패: ${reason}`)
  await sendThreadMessage(
    threadId,
    `❌ 인프라 반영 실패 (수동 확인 필요): ${reason.slice(0, 300)}\nPR 머지는 완료됐습니다.`
  )
  return  // 매핑 삭제 안 함 — CEO가 수동 확인 후 처리
}
```

## 작업 계획

### Step 1: `applyDbMigration` 내부 stderr 캡처 + 에러 판정 (구현팀)

- `applyDbMigration` 내부에서 execFile을 직접 호출하여 stdout+stderr 수집
- `/error:/i` 패턴 감지 시 `throw new Error(...)` 처리
- 함수 시그니처는 유지 (`Promise<void>`)
- 내부 try/catch 제거 (caller가 핸들링)

완료 기준: `applyDbMigration` 단위 테스트에서 exit 0 + stderr `error:` 패턴 → throw 확인

### Step 2: `runPostMergeInfra` blocking화 (구현팀)

- `applyDbMigration()` 호출 시 에러가 전파되도록 내부 try/catch 구조 조정
- launchd 재로드는 기존 non-blocking 유지

완료 기준: `runPostMergeInfra` 단위 테스트에서 DB 마이그레이션 실패 → throw 확인

### Step 3: `processMerge` 에러 핸들링 추가 (구현팀)

- `runPostMergeInfra` 호출부에 try/catch 추가
- 실패 시 스레드 알림 + return (매핑 삭제 안 함)

완료 기준: `processMerge` 통합 테스트에서 인프라 실패 시 스레드 알림 발송 + 이후 step 미실행 확인

### Step 4: 기존 테스트 통과 확인 (구현팀)

- `src/issue-processor/__tests__/mergeProcessor.test.ts` 전체 실행
- 기존 케이스가 깨지지 않아야 함

## 리스크

- `execFileP` 시그니처를 건드리지 않으므로 다른 호출부(gh, git 헬퍼) 영향 없음.
- `/error:/i` 패턴이 지나치게 넓을 수 있음 — drizzle-kit의 정상 출력에 "error" 문자열이 포함될 경우 false positive. 실제 drizzle-kit 출력 패턴 확인 필요. 좁히려면 `/^\s*error:/im` (줄 시작 기준)으로 조정 가능.
- 머지 완료 후 인프라 실패 시 매핑을 삭제하지 않으면 다음 "승인" 명령 시 중복 처리될 수 있음 — 이미 MERGED 상태이므로 `fetchPrState` 체크에서 걸러짐. 안전.

## 의사결정 필요

없음 — 바로 구현 가능
