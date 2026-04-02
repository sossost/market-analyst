# fetchIndexQuotes ANY SQL 오류 버그 수정

> Lite 트랙 — 단일 함수 버그픽스

## 선행 맥락

`memory/chief-of-staff.md`에 관련 히스토리 있음: PR #423(지수 FMP 전환) 당시
`marketDataLoader.ts` 전환이 불완전하게 처리된 이력이 있다. 이번 버그는 그 연장선.
`db.execute(sql\`...\`)` + Drizzle SQL 템플릿에 JavaScript 배열을 직접 보간하는
패턴이 유효하지 않은 SQL을 생성하고 있었으나, `.catch(() => [])` 가 묵묵히 삼켜
수개월간 증상만 나타났다.

## 골 정렬

**SUPPORT** — 지수 데이터(VIX, SPX 등락)는 시장 레짐 판단과 리포트 품질에 직접
기여한다. `debate_sessions.vix = null` 이 지속되면 Phase 2 포착 판단의 시장 맥락
섹션이 비어 출력된다. 버그픽스가 인프라 신뢰도를 복원하므로 골에 간접 기여.

## 문제

`fetchIndexQuotes`(marketDataLoader.ts:247)에서 Drizzle `sql` 템플릿에 JavaScript
배열을 `ANY(${symbolList})`로 직접 보간하면 PostgreSQL이 기대하는
`ANY(ARRAY['...', '...'])` 형식이 아닌 콤마 구분 스트링이 생성된다.
결과: 매일 `[MarketData] Loaded: 0 indices`, `vix = null` in `debate_sessions`.

## Before → After

**Before**
```
db.execute(sql`... WHERE symbol = ANY(${symbolList}) ...`)
// 생성 SQL: WHERE symbol = ANY('^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX')
// PostgreSQL 오류 → .catch(() => []) 가 삼킴 → 0건 반환
```

**After**
```
pool.query(`... WHERE symbol = ANY($1) ...`, [symbolList])
// 생성 SQL: WHERE symbol = ANY(ARRAY['...']) — pg 드라이버가 배열을 올바르게 바인딩
// + 에러 로깅 추가로 무음 실패 제거
```

## 변경 사항

### `src/debate/marketDataLoader.ts`

1. **임포트 추가**: `import { pool } from "@/db/client";`
   (`db`는 유지 — 파일 내 다른 쿼리에서 사용 중)

2. **`fetchIndexQuotes` 함수 교체** (line 240-289):
   - `db.execute(sql\`...\`)` → `pool.query<{symbol: string; date: string; close: string}>(...)`
   - SQL 문자열은 동일, 파라미터만 `$1` / `$2` 플레이스홀더로 교체
   - `rows.rows` 접근 → `rows.rows` (pg QueryResult 구조 동일하므로 후처리 로직 그대로)
   - `inArray` import 불필요 — 기존 Drizzle imports 변경 없음

3. **에러 핸들러 교체** (함수 호출부 `.catch`):
   - `.catch(() => [] as IndexQuote[])` →
     `.catch((e: unknown) => { logger.warn("MarketData", "fetchIndexQuotes failed", { error: String(e) }); return [] as IndexQuote[]; })`

## 작업 계획

| 단계 | 작업 | 담당 | 완료 기준 |
|------|------|------|-----------|
| 1 | `pool` 임포트 추가 | 구현팀 | lint 통과 |
| 2 | `fetchIndexQuotes` 내부 SQL → `pool.query` 교체 | 구현팀 | TS 타입 오류 없음 |
| 3 | `.catch` 핸들러 에러 로깅 추가 | 구현팀 | logger.warn 포함 확인 |
| 4 | 단위 테스트 추가 | 구현팀 | pool.query mock으로 정상/실패 케이스 커버 |
| 5 | 로컬 실행으로 smoke test | 구현팀 | `[MarketData] Loaded: 5 indices` 로그 확인 |

## 리스크

- `pool.query`의 반환 타입(`QueryResult<RowType>`)과 기존 `rows.rows` 접근 방식이
  동일하므로 후처리 로직 변경 불필요. 단, `QueryResult<T>.rows`의 `T` 타입을
  명시적으로 지정해야 타입 안전성 유지.
- `db.execute`에서 `pool.query`로 전환해도 동일 커넥션 풀을 사용하므로
  트랜잭션 맥락 이슈 없음 (이 함수는 단독 SELECT).

## 의사결정 필요

없음 — Option B(pool.query) 방향으로 자율 판단. 기존 프로젝트 패턴(saveWatchlist,
saveRecommendations 등)과 일치하며 추가 의존성 없음.
