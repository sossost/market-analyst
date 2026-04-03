# Plan: catalystLoader eps_surprises ANY() 배열 바인딩 오류 수정

## 골 정렬

- **판정: ALIGNED** — 토론 에이전트의 촉매 데이터 품질은 분석 정확도에 직접 영향. 매일 실패하는 회귀 버그이므로 즉시 수정 필요.
- **무효 판정: 해당 없음** — 명백한 버그 수정.

## 문제 정의

`src/debate/catalystLoader.ts`의 `fetchSectorBeatRates`와 `fetchPhase2News`에서 Drizzle `sql` 템플릿에 배열을 `ANY()`에 직접 바인딩하면 PostgreSQL이 `= ANY(($1, $2, ...))` 형태(튜플)로 해석하여 타입 오류 발생.

- **원인**: Drizzle `sql` 템플릿이 배열을 개별 파라미터로 펼침 → PostgreSQL `ANY()`가 요구하는 배열 타입과 불일치
- **영향**: #582 머지 이후 매일 촉매 데이터 로드 실패 → 실적 서프라이즈 비트율 + 뉴스 데이터 누락
- **범위**: 비블로킹이라 토론은 진행되나 촉매 분석 품질 저하

## Before → After

| | Before | After |
|---|--------|-------|
| `fetchSectorBeatRates` | `db.execute(sql\`...ANY(${array})...\`)` → 런타임 오류 | `pool.query(\`...ANY($1)...\`, [array])` → 정상 동작 |
| `fetchPhase2News` | 동일 패턴으로 동일 오류 가능 | `pool.query` 전환 |
| 촉매 데이터 | 매일 로드 실패 | 정상 로드 |

## 변경 사항

### 파일: `src/debate/catalystLoader.ts`

1. `pool` import 추가 (`@/db/client`에서)
2. `fetchSectorBeatRates`: `db.execute(sql`...)` → `pool.query(...)` 전환
   - SQL 문자열 리터럴 + 파라미터 배열 방식
   - `rows.rows` 접근 패턴은 동일 (pool.query도 `{ rows }` 반환)
3. `fetchPhase2News`: 동일하게 `pool.query` 전환
4. 불필요해진 Drizzle import 정리 (`sql` 등)

### 테스트

기존 테스트는 `formatCatalystContext`(순수 포매팅)만 커버. DB 쿼리 함수는 통합 테스트 영역이므로 기존 테스트에 영향 없음.

## 리스크

- **낮음**: `pool.query`는 프로젝트 전반에서 동일 패턴으로 사용 중 (stockPhaseRepository 등 20+ 사례)
- `fetchUpcomingEarnings`는 Drizzle `inArray`를 사용하므로 이 버그에 해당하지 않음 — 변경 불필요
