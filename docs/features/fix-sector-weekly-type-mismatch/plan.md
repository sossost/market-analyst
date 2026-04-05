# Plan: fix-sector-weekly-type-mismatch

## 문제 정의

`get_leading_sectors` 도구의 `mode: 'weekly'` 호출 시 DB 에러 발생:
- 에러 코드: `42883` — `operator does not exist: text < timestamp without time zone`
- 원인: `sectorRepository.ts:118`의 `findPrevWeekDate` SQL에서 `$1::date - INTERVAL '5 days'`가 `timestamp` 타입을 반환하는데, `sector_rs_daily.date` 컬럼은 `text` 타입이라 비교 불가

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `findPrevWeekDate` SQL | `WHERE date < ($1::date - INTERVAL '5 days')` | `WHERE date < ($1::date - 5)::text` |
| weekly 모드 | 42883 에러로 전면 실패 | 정상 동작 |

## 변경 사항

- `src/db/repositories/sectorRepository.ts:118` — INTERVAL 연산 대신 정수 뺄셈(`date - integer`) 사용 후 `::text` 캐스팅
  - `($1::date - 5)::text` — PostgreSQL에서 `date - integer = date`이므로 timestamp 중간 타입 회피
  - 동일 패턴이 `stockPhaseRepository.ts:282`, `groupRsRepository.ts:100` 등에서 이미 `::text` 캐스팅으로 사용 중

## 작업 계획

1. `sectorRepository.ts:118` SQL 수정
2. 기존 테스트 통과 확인

## 리스크

- **낮음**: 변경이 SQL 캐스팅 1줄이며, 동일 패턴이 프로젝트 내 다수 사용됨
- `date` 컬럼이 text인 것이 근본 원인이지만, 스키마 변경은 이 이슈 범위 밖

## 골 정렬

- **ALIGNED** — `get_leading_sectors` weekly 모드는 주간 리포트의 전주 대비 섹터 순위 변동 분석에 필수. 이 버그로 주간 분석 파이프라인 전체가 차단됨.
- **무효 판정**: 해당 없음 (P1 버그픽스)
