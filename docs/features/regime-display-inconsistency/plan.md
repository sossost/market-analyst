# Plan: 레짐 표시 불일치 수정

## 문제 정의

`market_regimes` 테이블을 읽는 쿼리들 사이에 `is_confirmed` 필터 적용이 일관적이지 않다.

- **일간 리포트** (`regimeStore.ts:loadConfirmedRegime`): `is_confirmed = true` 필터 적용 → 확정 레짐만 반환 (올바름)
- **기업 분석** (`corporateRepository.ts:findMarketRegimeByDate`): `is_confirmed` 필터 없음 → 미확정 레짐도 반환 (버그)
- **마켓펄스/대시보드**: control-tower 레포에서 `is_confirmed` 필터 누락 (별도 레포, 별도 이슈)

## Before → After

| 소스 | Before | After |
|------|--------|-------|
| `findMarketRegimeByDate()` | 미확정 포함 최신 레짐 반환 | 확정 레짐만 반환 |
| 기업 분석 리포트 | 미확정 레짐 기반 분석 가능 | 확정 레짐만 사용 |

## 변경 사항

### market-analyst 레포 (이 PR)

1. `src/db/repositories/corporateRepository.ts:findMarketRegimeByDate()`
   - `WHERE regime_date <= $1` → `WHERE regime_date <= $1 AND is_confirmed = true`

### control-tower 레포 (별도 이슈)

마켓펄스/대시보드의 레짐 조회 쿼리에 동일한 필터 추가 필요. 이 PR 범위 밖.

## 리스크

- **확정 레짐 없는 경우**: 해당 날짜 이전에 확정 레짐이 없으면 빈 배열 반환. 호출부 `loadAnalysisInputs.ts`에서 `safeQuery`로 감싸고 있어 null-safe. 기업 분석은 레짐 없이도 진행 가능 (optional 필드).
- **수정 범위**: 1개 파일, 1줄 변경. 영향 최소.

## 골 정렬

ALIGNED — 분석 리포트의 데이터 정확성은 프로젝트 핵심 목표(정확한 시장 분석) 직결.

## 무효 판정

해당 없음 (버그 수정).
