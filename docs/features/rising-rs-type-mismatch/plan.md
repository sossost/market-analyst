# Plan: RisingRS 로드 실패 — text = date 타입 불일치 수정

**이슈**: #477
**트랙**: Lite (단순 버그픽스)
**날짜**: 2026-03-28

## 문제 정의

`findRisingRsStocks` SQL 쿼리에서 동일 파라미터 `$1`이 두 가지 타입 컨텍스트로 사용됨:

1. **CTE 내부 (L255)**: `$1::date - INTERVAL '28 days'` → PostgreSQL이 `$1` 타입을 `date`로 추론
2. **WHERE 절 (L273)**: `sp.date = $1` → `stock_phases.date`는 `text` 컬럼 → `text = date` 비교 시도 → 42883 에러

PostgreSQL이 동일 파라미터의 타입을 단일 타입으로 통합 추론하면서, `::date` 캐스트가 있는 쪽이 우선 적용되어 타입 불일치 발생.

## Before → After

| | Before | After |
|---|--------|-------|
| L273 | `sp.date = $1` | `sp.date = $1::text` |
| 결과 | 42883 에러로 RisingRS 데이터 누락 | 정상 로드 |

## 변경 사항

- **파일**: `src/db/repositories/stockPhaseRepository.ts`
- **수정**: L273 `sp.date = $1` → `sp.date = $1::text` (명시적 text 캐스트)
- **수정 범위**: 1줄

## 골 정렬

- **ALIGNED** — EarlyDetection의 RisingRS가 빈 배열로 대체되면서 조기포착 품질이 저하되는 프로덕션 버그. 시장 분석 정확도에 직접 영향.

## 무효 판정

- **해당 없음** — 프로덕션 에러 수정. 무효 사유 없음.

## 리스크

- **극히 낮음**: 명시적 캐스트 추가일 뿐, 쿼리 로직 변경 없음
- `srd.date = sp.date` (L272)도 같은 text 타입이므로 영향 없음

## 잠재적 동일 패턴

- L824-825 `findThesisBeneficiaryTickers`: 동일 패턴(`$1::date` + `$1` 비교)이나, 현재 에러 미발생. 별도 이슈로 추적 권장.
