# fix: 트리아지 배치 Claude CLI 타임아웃 버그 수정

## 선행 맥락

`fix-triage-relabel` 피처에서 triageBatch.ts의 구조를 개편한 이력이 있다.
당시 PROCEED 이슈에 `triaged` 라벨을 붙이는 로직을 추가하고, `fetchUntriagedIssues()`를
배치 전용 함수로 분리했다.

현재 triageBatch.ts는 이슈 간 딜레이 없이 순차 처리한다. Claude CLI 세션이
완료된 직후 다음 세션이 바로 시작되면 리소스 경합이 발생하고 이것이
타임아웃의 근본 원인이다.

## 골 정렬

SUPPORT — 자율 이슈 처리 파이프라인의 안정성 개선. 트리아지 배치가 실패하면
이슈 프로세서 대기열이 누락되어 구현 파이프라인 전체가 지연된다.
인프라 품질에 해당하지만 이슈 프로세서가 이 프로젝트의 구현 엔진이므로
직접 기여에 준한다.

## 문제

트리아지 배치에서 다수의 이슈(예: 4건)를 연속 처리할 때,
앞 이슈의 Claude CLI 세션이 종료된 직후 다음 세션이 바로 시작된다.
이 과정에서 리소스 경합이 발생하여 5분 타임아웃을 초과한다.
타임아웃이 발생하면 `triaged` 라벨이 부착되지 않아 해당 이슈가
다음 배치 실행 시까지 이슈 프로세서 대기열에서 누락된다.

## Before → After

**Before**
- `triageBatch.ts`: 이슈 간 딜레이 없이 순차 처리 (`for...of` 루프)
- `triageIssue.ts`: `TRIAGE_TIMEOUT_MS = 5 * 60 * 1_000` (5분)
- 4건 연속 처리 시 3~4번째 이슈에서 타임아웃 발생 → `triaged` 라벨 미부착

**After**
- `triageBatch.ts`: 각 이슈 처리 완료 후 10초 대기 (단, 마지막 이슈는 대기 불필요)
- `triageIssue.ts`: `TRIAGE_TIMEOUT_MS = 8 * 60 * 1_000` (8분)
- 이슈 간 간격 확보로 리소스 경합 해소, 타임아웃 여유 추가 확보

## 변경 사항

### 1. `src/issue-processor/triageIssue.ts`

```typescript
// 변경 전
const TRIAGE_TIMEOUT_MS = 5 * 60 * 1_000 // 5분

// 변경 후
const TRIAGE_TIMEOUT_MS = 8 * 60 * 1_000 // 8분
```

**변경 이유**: 5분은 정상 Claude CLI 세션에도 빠듯하다. 리소스 경합이 없는
상황에서도 복잡한 이슈 분석 시 5분이 모자랄 수 있다. 8분은 일반적인
`--print` 모드 세션 완료 시간(~3분)의 2.5배 이상으로 충분한 여유다.

### 2. `src/issue-processor/triageBatch.ts`

`for...of` 루프 내부, 각 이슈 처리 블록(try/catch) 완료 이후 딜레이를 추가한다.

```typescript
// 추가할 상수
const INTER_ISSUE_DELAY_MS = 10 * 1_000 // 10초

// 루프 내 변경 — try/catch 블록 이후, 다음 이슈 진행 전
for (let i = 0; i < issues.length; i++) {
  const issue = issues[i]
  try {
    // ... 기존 처리 로직 그대로 ...
  } catch (err) {
    // ... 기존 에러 처리 그대로 ...
  }

  // 마지막 이슈는 대기 불필요
  if (i < issues.length - 1) {
    log(`  ⏱ 다음 이슈 처리 전 ${INTER_ISSUE_DELAY_MS / 1_000}초 대기`)
    await new Promise((resolve) => setTimeout(resolve, INTER_ISSUE_DELAY_MS))
  }
}
```

**변경 이유**: Claude CLI 세션은 프로세스를 fork하고 API 연결을 맺는다.
세션 종료 후 즉시 다음 세션을 시작하면 이전 세션의 프로세스 정리가
완료되기 전에 리소스(API 연결 슬롯, 로컬 프로세스)를 재사용하려 한다.
10초는 Claude CLI 프로세스가 완전히 정리되기에 충분한 시간이며,
배치 전체 실행 시간(10초 × n)에 미치는 영향은 수용 가능하다.

**루프 구조 변경**: `for...of` → `for` (인덱스가 필요하므로)

## 작업 계획

| 단계 | 파일 | 변경 내용 | 완료 기준 |
|------|------|----------|----------|
| 1 | `triageIssue.ts` | `TRIAGE_TIMEOUT_MS` 5분 → 8분 | 상수 변경, 타입 에러 없음 |
| 2 | `triageBatch.ts` | `INTER_ISSUE_DELAY_MS` 상수 추가 + `for...of` → `for` + 이슈 간 딜레이 삽입 | 루프 로직 동작 보존, 딜레이 로그 출력 |
| 3 | 테스트 업데이트 | `triageBatch.test.ts` — 딜레이 관련 mock/spy 추가, 기존 테스트 통과 확인 | `yarn test` 전체 통과 |

## 리스크

- **배치 실행 시간 증가**: 이슈 10건 기준 최대 90초(10초 × 9회) 증가. 트리아지 배치는 09:00 KST에 단독 실행되며 이슈 프로세서(10:00 KST)와 1시간 간격이 있으므로 영향 없음.
- **딜레이 중 프로세스 종료**: `setTimeout`은 Node.js 이벤트 루프가 살아 있어야 동작한다. 트리아지 배치는 `runTriageBatch()` 완료까지 프로세스가 유지되므로 문제없음.
- **타임아웃 상향의 부작용**: 실제 무한 대기 상황(claude binary 없음 등)은 `classifyCliError`가 ENOENT로 분류하여 즉시 reject하므로 8분을 기다리지 않는다. 실질적 위험 없음.

## 의사결정 필요

없음 — 바로 구현 가능.
