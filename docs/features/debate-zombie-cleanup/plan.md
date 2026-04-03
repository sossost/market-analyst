# Plan: 토론 에이전트 zombie claude 프로세스 정리

## 문제 정의

`ClaudeCliProvider.call()`에서 `execFile`로 생성한 child process가 에러 시 명시적으로 종료되지 않음.
타임아웃, 세션 한도 초과 등으로 실패 시 claude 프로세스가 zombie로 남아 Claude Max 동시 세션 슬롯을 점유.
누적되면 후속 토론 실행이 세션 한도에 걸려 실패한다.

## Before → After

| | Before | After |
|---|---|---|
| 에러 시 child process | reject()만 호출, child 방치 | child.kill() 후 reject() |
| 프로세스 종료 시 | 정리 없음 | 추적된 child 일괄 kill |
| zombie 누적 | 실행마다 누적 | 즉시 정리 |

## 변경 사항

### 1. `src/debate/llm/claudeCliProvider.ts` — 에러 경로에 child.kill() 추가

- `call()` 에러 콜백에서 `child.kill('SIGTERM')` 호출 (try-catch 보호)
- 활성 child process Set 추적: `activeChildren`
- `dispose()` 메서드 추가: 남은 child 일괄 정리
- 정적 메서드 `killAll()`: 모든 인스턴스 정리 없이 프로세스 레벨 정리

### 2. `src/agent/run-debate-agent.ts` — 프로세스 종료 핸들러

- `process.on('exit')` 핸들러에서 `ClaudeCliProvider.killAll()` 호출
- main() catch 블록에서도 정리 호출

## 작업 계획

1. `claudeCliProvider.ts` 수정 — child 추적 + 에러 시 kill + dispose/killAll
2. `run-debate-agent.ts` 수정 — exit 핸들러 추가
3. 테스트 업데이트 — 에러 시 child.kill 호출 검증, dispose/killAll 검증
4. 타입 체크 + 테스트 통과 확인

## 리스크

- `child.kill()`은 이미 종료된 프로세스에 호출 시 에러 가능 → try-catch로 보호
- `execFile` 콜백 시점에 이미 프로세스가 종료된 경우가 많음 → kill 실패해도 무해
- 골 정렬: ALIGNED — zombie 정리는 토론 파이프라인 안정성 직결
- 무효 판정: 해당 없음 — 방어 코드 추가이므로 기존 동작에 영향 없음
