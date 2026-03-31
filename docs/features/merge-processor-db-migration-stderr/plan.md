# Plan: mergeProcessor DB 마이그레이션 stderr 에러 감지 + blocking 처리

## 문제 정의

ETL 데일리 실패 시 Discord에 "✅ DB 마이그레이션 완료"로 보고되는 버그.

### 근본 원인

1. **exit code 맹신**: `yarn db:push --force`가 exit 0으로 종료해도 stderr에 `error:` 패턴이 포함된 경우 실제 DB 작업은 실패. 현재 `execFileP`는 exit 0이면 stdout만 반환하고 stderr는 무시.
2. **non-blocking 처리**: `applyDbMigration()`이 try/catch로 에러를 삼키므로, DB 마이그레이션 실패해도 머지 흐름이 계속 진행됨.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| exit 0 + stderr `error:` | ✅ 성공으로 보고 | ❌ 실패로 처리 + throw |
| DB 마이그레이션 실패 시 머지 흐름 | 계속 진행 (non-blocking) | 중단 (throw → catch in processMerge) |
| 실패 알림 | applyDbMigration 내부에서만 | processMerge에서 스레드 알림 + return |
| 매핑 삭제 | 항상 삭제 | 인프라 실패 시 유지 (수동 확인 필요) |

## 변경 사항 (1 파일)

### `src/issue-processor/mergeProcessor.ts`

1. **`execFileDetailed()` 신규 헬퍼**: `execFile`을 래핑하되, 성공 시 `{ stdout, stderr }` 모두 반환. 기존 `execFileP`는 다른 호출자가 사용하므로 건드리지 않음.

2. **`applyDbMigration()`**:
   - `execFileP` → `execFileDetailed` 사용
   - exit 0이어도 stdout+stderr에 `error:` 패턴 있으면 `throw new Error(...)`
   - try/catch 제거 — 에러는 호출자(`runPostMergeInfra`)에 전파

3. **`runPostMergeInfra()`**:
   - `applyDbMigration()` 호출 전후에 try/catch 없음 (현재도 없음)
   - `applyDbMigration()`이 throw하면 자연스럽게 전파

4. **`processMerge()`**:
   - `runPostMergeInfra()` 호출을 try/catch로 감싸기
   - catch 시: 스레드에 `❌ 인프라 반영 실패` 알림 + return
   - 매핑 삭제하지 않음 (머지는 완료됐지만 인프라 미반영 상태 표시)

### `src/issue-processor/__tests__/mergeProcessor.test.ts`

1. `mockExecSequence` 헬퍼에 `stderr` 필드 추가
2. 테스트 추가:
   - `applyDbMigration: exit 0 + stderr error: → 실패 처리` (processMerge를 통해 검증)
   - `runPostMergeInfra: DB 마이그레이션 실패 시 throw` (processMerge를 통해 검증)
   - `processMerge: 인프라 반영 실패 시 스레드 알림 후 return (매핑 유지)` (직접 검증)

## 작업 계획

1. `mergeProcessor.ts` — `execFileDetailed` 추가
2. `mergeProcessor.ts` — `applyDbMigration` 수정
3. `mergeProcessor.ts` — `processMerge` 에러 핸들링 추가
4. `mergeProcessor.test.ts` — 테스트 추가
5. 기존 테스트 통과 확인

## 골 정렬

- **판정**: SUPPORT
- **근거**: DB 마이그레이션 실패 무시는 ETL 파이프라인 장애 → Phase 2 데이터 수집/분석 중단으로 이어짐. 인프라 안정성은 모든 분석 파이프라인의 전제 조건.

## 무효 판정

- **판정**: 해당 없음 (LLM 백테스트 등 무효 패턴 아님. 순수 인프라 버그 수정.)

## 리스크

- **낮음**: 변경 범위가 1 파일 내 3개 함수로 제한됨
- `reloadLaunchd`는 기존과 동일하게 non-blocking 유지 (launchd 실패는 머지 흐름에 치명적이지 않음)
