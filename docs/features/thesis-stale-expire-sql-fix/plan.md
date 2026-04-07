# Plan: thesis 안전망 만료 쿼리 SQL 에러 수정

## 문제 정의

`expireStalledTheses()` 함수의 SQL 쿼리에서 Drizzle ORM이 `STALE_EXPIRE_PROGRESS` (0.5)를
SQL 파라미터(`$6`)로 바인딩하면서 PostgreSQL이 타입을 추론하지 못해 `integer * unknown` 연산 실패.

```sql
FLOOR("theses"."timeframe_days" * $6)::int * interval '1 day'
```

이로 인해 stale thesis 안전망 만료가 전혀 동작하지 않아, 만료 대상 thesis가 ACTIVE 풀에 잔류.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 안전망 만료 쿼리 | SQL 에러로 실패 | 정상 실행 |
| stale ACTIVE thesis | 풀에 계속 잔류 | 진행률 50%+ 시 만료 처리 |

## 변경 사항

### 파일: `src/debate/thesisStore.ts` (571번 라인)

**방법**: `sql.raw()`로 상수를 인라인 삽입

```ts
// Before
sql`${theses.debateDate}::date + FLOOR(${theses.timeframeDays} * ${STALE_EXPIRE_PROGRESS})::int * interval '1 day' <= ${today}::date`

// After
sql`${theses.debateDate}::date + FLOOR(${theses.timeframeDays} * ${sql.raw(String(STALE_EXPIRE_PROGRESS))})::int * interval '1 day' <= ${today}::date`
```

**근거**: `STALE_EXPIRE_PROGRESS`는 코드 상수 (0.5)이므로 SQL 인젝션 위험 없음. `sql.raw()`로 직접 인라인하면 PostgreSQL이 `numeric` 리터럴로 인식하여 타입 추론 성공.

### 테스트 추가

`__tests__/agent/debate/thesisStore.test.ts`에 `expireStalledTheses` 실행 검증 테스트 추가.

## 영향 범위

- 수정 파일: `src/debate/thesisStore.ts` 1곳 (571번 라인)
- 173번 라인 `expireStaleTheses`: 상수 파라미터 없음 → 영향 없음
- 203번 라인 `resolveOrExpireStaleTheses`: SELECT 후 개별 처리 패턴 → 영향 없음
- 573번 라인 (같은 함수 내 두 번째 조건): 컬럼 직접 참조만 사용 → 영향 없음

## 리스크

- `sql.raw()`에 외부 입력이 전달되면 SQL 인젝션 위험. 단, 여기서는 코드 상수만 사용하므로 안전.
- 검증 항목: 수정 후 실제 DB에서 stale thesis 만료 쿼리가 에러 없이 실행되는지 확인 필요.

## 골 정렬

- **ALIGNED** — thesis 생태계 건강성은 분석 품질의 핵심. stale thesis 미정리는 학습 루프 오염과 리소스 낭비 직결.

## 무효 판정

- **해당 없음** — 명확한 SQL 파라미터 바인딩 버그. 수정 방향이 단일하고 영향 범위 제한적.
