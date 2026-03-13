# TSC 타입 에러 수정

Closes #206

## 선행 맥락

없음 — TSC 타입 에러 수정은 신규 이슈.

## 골 정렬

SUPPORT — 타입 안정성 확보는 직접적인 알파 형성에 기여하지 않으나,
CI 통과와 코드 신뢰성 유지를 위한 인프라 작업. 우선순위 P1(bug) 으로 처리한다.

## 문제

`npx tsc --noEmit` 실행 시 소스 2개 + 테스트 4개에서 타입 에러 발생.
CI가 통과하지 못하며, 타입 안전성 보장이 깨져 있다.

## Before → After

**Before**: `npx tsc --noEmit` 종료 코드 2, 에러 18개.

**After**: `npx tsc --noEmit` 종료 코드 0, 에러 0개.
테스트 동작은 변경 없음 — 타입 표현만 수정.

## 변경 사항

### 소스 파일 2개

#### 1. `src/agent/dailyQA.ts:175` — TS2554: Expected 2 arguments, but got 3

**원인**: `logger.info(tag, message)` 시그니처는 인수 2개인데, catch 블록에서 3번째 인수로 `error` 객체를 전달.

```typescript
// Before
logger.info("DailyQA",
  `[DailyQA] DB 쿼리 실패 — graceful warn 반환:`,
  error instanceof Error ? error.message : error,  // 3번째 인수
);

// After
logger.info("DailyQA",
  `[DailyQA] DB 쿼리 실패 — graceful warn 반환: ${error instanceof Error ? error.message : String(error)}`,
);
```

**수정 방향**: 3번째 인수(에러 메시지)를 템플릿 리터럴로 2번째 인수에 병합.

---

#### 2. `src/lib/sectorLagStats.ts:93` — TS2339: Property 'lagDays' does not exist on type 'never'

**원인**: TypeScript control flow 분석이 `let bestMatch: { followerDate: string; lagDays: number } | null = null`을
루프 내부에서 `never`로 좁히는 버그. `if (bestMatch == null || lag < bestMatch.lagDays)` 조건에서
`bestMatch`가 `null` 아닌 브랜치에서 `never`로 추론됨.

```typescript
// Before
if (bestMatch == null || lag < bestMatch.lagDays) {  // bestMatch가 never로 추론
  bestMatch = { followerDate, lagDays: lag };
  break;
}

// After — 명시적 null 가드로 분리
if (bestMatch == null) {
  bestMatch = { followerDate, lagDays: lag };
  break;
}
if (lag < bestMatch.lagDays) {
  bestMatch = { followerDate, lagDays: lag };
  break;
}
```

**수정 방향**: `||` 복합 조건을 분리하여 control flow 추론 오류를 우회.
로직 동작은 동일하게 유지.

---

### 테스트 파일 4개

#### 3. `__tests__/agent/fundamental/runFundamentalValidation.test.ts` — TS2345 x 4

**에러 종류:**
- 라인 209, 242, 288: `analyzeFundamentals` mock 반환값에 `symbol` 누락
  (`FundamentalAnalysis`는 `symbol: string` 필드를 요구하나 mock에 없음)
- 라인 215, 294: `publishStockReport` mock에 `undefined` 전달
  (`{ gistUrl: string | null }` 타입을 요구하나 `undefined` 전달)

**수정 방향:**
- `analyzeFundamentals` mock 반환값에 `symbol` 필드 추가
  (각 mock에 해당 종목 심볼 명시 — "NVDA", "AAPL" 등)
- `publishStockReport` mock을 `mockResolvedValue(undefined)` 대신
  `mockResolvedValue({ gistUrl: null })` 로 수정

---

#### 4. `__tests__/agent/reportLog.test.ts` — TS2352 x 3 (라인 110, 176, 219)

**원인**: Drizzle ORM의 `db.insert`, `db.select` 반환값 mock을
`as ReturnType<typeof db.insert>` / `as ReturnType<typeof db.select>` 로 캐스팅하는데,
mock 객체가 실제 Drizzle 빌더 타입과 겹치는 구조가 없어 TS2352 발생.

**수정 방향**: 중간에 `unknown` 캐스팅을 추가하여 double assertion 패턴 적용.

```typescript
// Before
} as ReturnType<typeof db.insert>

// After
} as unknown as ReturnType<typeof db.insert>
```

라인 110, 176, 219 동일 패턴으로 3곳 수정.

---

#### 5. `__tests__/issue-processor/executeIssue.test.ts` — TS2769 x 4 (라인 77, 102, 134, 149)

**원인**: `exec`의 타입 정의가 `{ stdout: Readable; stderr: Readable; }` 를 요구하는데,
`mockResolvedValueOnce({ stdout: 'string', stderr: 'string' })`으로 문자열을 전달.
`promisify`된 `exec`의 타입 오버로드와 mock의 반환 타입이 불일치.

**수정 방향**: mock 반환값을 `as any`로 캐스팅.

```typescript
// Before
vi.mocked(mockExec).mockResolvedValueOnce({
  stdout: '...',
  stderr: '',
})

// After
vi.mocked(mockExec).mockResolvedValueOnce({
  stdout: '...',
  stderr: '',
} as any)
```

라인 77, 102, 134, 149 동일 패턴으로 4곳 수정.

---

#### 6. `__tests__/issue-processor/githubClient.test.ts` — TS2769 x 1 (라인 22)

**원인**: 위와 동일 — `execFile` mock 반환값에 `stdout`이 `string`인데 `Readable` 기대.

```typescript
function mockGhResponse(stdout: string): void {
  vi.mocked(mockExecFile).mockResolvedValueOnce({ stdout })
  // After:
  vi.mocked(mockExecFile).mockResolvedValueOnce({ stdout } as any)
}
```

## 작업 계획

| 단계 | 파일 | 수정 내용 | 완료 기준 |
|------|------|----------|---------|
| 1 | `src/agent/dailyQA.ts` | logger.info 3인수 → 2인수 병합 | TSC 에러 0 |
| 2 | `src/lib/sectorLagStats.ts` | `||` 조건 분리 | TSC 에러 0 |
| 3 | `__tests__/agent/fundamental/runFundamentalValidation.test.ts` | symbol 추가, publishStockReport mock 수정 | TSC 에러 0 |
| 4 | `__tests__/agent/reportLog.test.ts` | `as unknown as` 패턴 적용 3곳 | TSC 에러 0 |
| 5 | `__tests__/issue-processor/executeIssue.test.ts` | mock 반환값 `as any` 추가 4곳 | TSC 에러 0 |
| 6 | `__tests__/issue-processor/githubClient.test.ts` | mock 반환값 `as any` 추가 1곳 | TSC 에러 0 |

**담당**: 실행팀 구현 에이전트 1명 (병렬 불가 — 단일 파일 수정 흐름)

**최종 검증**: `npx tsc --noEmit && yarn test` 모두 통과.

## 리스크

- `as any` 사용 — 타입 안전성을 일부 희생하지만, 테스트 mock 코드에서는 허용 범위.
  소스 코드(1, 2번)에는 `as any` 사용 없음.
- `sectorLagStats.ts` 조건 분리 후 로직 동일성 확인 필요.
  기존 테스트가 통과하면 동작 보장.

## 의사결정 필요

없음 — 바로 구현 가능.
