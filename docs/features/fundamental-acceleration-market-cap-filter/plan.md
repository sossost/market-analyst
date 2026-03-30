# Plan: FundamentalAcceleration DB 쿼리 시가총액 필터 추가

**이슈**: #510
**트랙**: Lite (단순 필터 누락 수정)

## 문제 정의

`fundamentalRepository.ts`의 `findFundamentalAcceleration()` SQL 쿼리에 시가총액 필터(`MIN_MARKET_CAP`)가 누락되어 있다.
동일 시스템의 `getPhase1LateStocks`, `getRisingRS`에는 이미 적용되어 있으나 이 경로만 빠져 있어 소형주 noise가 `earlyDetectionContext`에 유입될 수 있다.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `findFundamentalAcceleration` SQL | `symbols s` JOIN은 있으나 `market_cap` 필터 없음 | `s.market_cap::numeric >= $1` 조건 + `MIN_MARKET_CAP` 파라미터 추가 |
| 소형주 유입 | Phase 1/2 + RS≥20이면 시가총액 무관 통과 | $300M 미만 소형주 차단 |
| 필터 일관성 | 3개 도구 중 1개 누락 | 3개 도구 모두 동일 필터 |

## 변경 사항

### 1. `src/db/repositories/fundamentalRepository.ts`
- `MIN_MARKET_CAP` import 추가
- `target_symbols` CTE의 FROM에 `JOIN symbols s ON sp.symbol = s.symbol` 추가
- WHERE에 `AND s.market_cap::numeric >= $1` 추가
- 쿼리 파라미터에 `MIN_MARKET_CAP` 전달

### 2. `__tests__/agent/tools/fundamentalAcceleration.test.ts`
- `findFundamentalAcceleration` 쿼리가 `market_cap` 필터를 포함하는지 검증하는 테스트 추가
- `MIN_MARKET_CAP` (300M) 값이 파라미터로 전달되는지 검증

## 리스크

- **낮음**: 기존 패턴과 동일한 방식의 필터 추가. 다른 두 도구에서 이미 검증된 패턴.
- `symbols` 테이블 JOIN은 이미 메인 쿼리에 존재하므로 CTE에 추가해도 성능 영향 최소.

## 골 정렬

- **ALIGNED** — "Phase 2 주도섹터/주도주 초입 포착" 목표에서 소형주 noise 차단은 추천 품질의 기본 조건. 세 도구 간 필터 일관성 확보.

## 무효 판정

- **해당 없음** — LLM 백테스트 등 무효 패턴 아님. 단순 DB 쿼리 필터 추가.
