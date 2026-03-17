# fix: get-latest-weekly-report.ts pool.end() 중복 호출 에러

## 선행 맥락

없음 — 첫 발생 이슈.

단, `pool.end()` 중복 호출 패턴은 프로젝트 전반에 만연한 구조적 문제다.
`grep -rn "pool\.end()"` 결과: ETL 파일 30여 개에서 try/catch/finally 블록에
중복 호출이 산재되어 있음. 이 이슈는 그 중 한 건을 수정한다.

## 골 정렬

SUPPORT — 인프라 안정성. 주간 QA 파이프라인이 에러로 중단되면
리포트 품질 검증이 누락된다. 간접적으로 골에 기여.

## 문제

`validate-weekly-report.sh`에서 `npx tsx src/scripts/get-latest-weekly-report.ts`
실행 시 `Called end on pool more than once` 에러 발생.

### 원인 분석

`get-latest-weekly-report.ts`의 현재 구조:

```typescript
async function main(): Promise<void> {
  try {
    // DB 조회
  } finally {
    await pool.end();   // [A] 항상 실행
  }
}

main().catch((error: unknown) => {
  console.error(`[get-latest-weekly-report] ${message}`);
  process.exit(1);
});
```

에러 발생 경로는 두 가지다:

**경로 1 — pool.end() 자체 실패:**
1. DB 조회 도중 에러 발생
2. `finally` 블록 진입 → `await pool.end()` 호출
3. `pool.end()` 내부에서 추가 에러 발생 (이미 종료 중인 pool에 재호출 등)
4. `main()` 전체가 reject → `.catch()` 핸들러 실행
5. `process.exit(1)` 호출

이 경로에서 `pool.end()`가 reject되면 에러 메시지에
`Called end on pool more than once`가 포함된다.

**경로 2 — pg 드라이버 내부 이벤트 중복 (pg 8.x 버그):**
`pool.end()` 호출 후 내부적으로 idle 커넥션 종료 과정에서
`end` 이벤트가 중복 발생하는 경우가 있다.
`allowExitOnIdle: false` 설정 시 이 경로가 더 자주 발생한다.

**핵심**: `finally`에 `pool.end()`를 두면, DB 조회 에러 + pool.end 에러가
겹칠 때 원래 에러가 pool.end 에러로 덮인다.
또한 `pool.end()` 자체가 에러를 던지면 `.catch()` 핸들러가 받아
`process.exit(1)` 후 프로세스가 비정상 종료된다.

같은 파일에서 `get-latest-report.ts`를 import하는데,
두 파일이 동일한 `pool` 인스턴스를 공유한다(`db/client.ts` 싱글턴).
단독 실행이므로 교차 호출은 없지만, `pool`이 이미 종료 상태인 경우
재호출이 `Called end on pool more than once`를 유발한다.

## Before → After

**Before**: `finally`에 무조건 `pool.end()` → 에러 경로에서 중복 호출 가능

```typescript
async function main(): Promise<void> {
  try {
    const rows = await db.select()...
    // ...
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[get-latest-weekly-report] ${message}`);
  process.exit(1);
});
```

**After**: `pool.end()`를 `finally`에서 안전하게 호출. 에러가 발생해도
pool 종료 에러가 원래 에러를 덮지 않도록 분리.

```typescript
async function main(): Promise<void> {
  try {
    const rows = await db.select()...
    // ...
  } finally {
    await pool.end().catch(() => {
      // pool.end 자체 에러는 무시 (이미 종료됐거나 상태 불명확)
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[get-latest-weekly-report] ${message}`);
  process.exit(1);
});
```

## 변경 사항

### 수정 대상 파일
- `src/scripts/get-latest-weekly-report.ts` — pool.end() 방어 처리

### 구체적 변경

**라인 43-45** (현재):
```typescript
  } finally {
    await pool.end();
  }
```

**변경 후**:
```typescript
  } finally {
    await pool.end().catch(() => {
      // pool이 이미 종료됐거나 종료 중인 경우 에러 무시
    });
  }
```

`get-latest-report.ts`와 `get-latest-debate-report.ts`도 동일한 패턴이므로
같은 PR에서 함께 수정한다 (스코프 확대).

### 수정 대상 전체
| 파일 | 현재 상태 | 조치 |
|------|----------|------|
| `src/scripts/get-latest-weekly-report.ts` | `await pool.end()` 단독 | `.catch(() => {})` 추가 |
| `src/scripts/get-latest-report.ts` | `await pool.end()` 단독 | `.catch(() => {})` 추가 |
| `src/scripts/get-latest-debate-report.ts` | `await pool.end()` 단독 | `.catch(() => {})` 추가 |

ETL 파일들(30여 개)의 중복 호출 문제는 별도 이슈로 분리. 이번 PR 스코프 밖.

## 작업 계획

### Step 1 — 코드 수정 (구현팀)

**대상**: 위 3개 파일
**완료 기준**:
- `pool.end()`에 `.catch(() => {})` 추가
- 기존 동작 유지 (에러 시 `process.exit(1)`, stdout JSON 출력 형식 불변)

### Step 2 — 수동 검증 (구현팀)

```bash
# 정상 실행 확인
npx tsx src/scripts/get-latest-weekly-report.ts

# JSON 형식 검증
npx tsx src/scripts/get-latest-weekly-report.ts | jq .

# get-latest-report, get-latest-debate-report도 동일 확인
```

**완료 기준**: stdout에 유효한 JSON 출력, `Called end on pool more than once` 에러 없음

### Step 3 — 코드 리뷰 + PR (pr-manager)

**완료 기준**: CRITICAL/HIGH 이슈 없음, PR 생성

## 리스크

- **낮음**: 변경 범위가 단 1줄(per 파일). 기존 로직에 영향 없음.
- `pool.end()` 에러를 무시하므로, pool이 실제로 종료되지 않아도 프로세스가 계속될 수 있다.
  그러나 이 스크립트는 `process.exit(1)` 또는 정상 종료로 끝나므로 프로세스 수명이 짧아 문제없다.
- ETL 파일들의 근본적인 pool.end() 중복 구조는 이번 PR에서 해결하지 않는다.
  별도 이슈(기술 부채)로 트래킹 필요.

## 의사결정 필요

없음 — 바로 구현 가능.
