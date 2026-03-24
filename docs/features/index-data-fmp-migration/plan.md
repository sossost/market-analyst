# Plan: 지수 데이터 소스 Yahoo Finance → FMP 전환

**이슈:** #420
**날짜:** 2026-03-24

---

## 문제 정의

현재 `getIndexReturns` 도구가 Yahoo Finance 비공식 API를 사용하여 지수 데이터를 조회한다.

**문제점:**
1. `range` 파라미터에 따라 `chartPreviousClose`가 예상과 다른 값을 반환 (#417, #419)
2. 비공식 API라 문서 없이 동작이 변경될 수 있음 — 사전 경고 없는 장애 위험
3. 지수 데이터가 DB에 저장되지 않아 사후 검증 불가 — 리포트의 지수 수치를 검증할 수 없음

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 데이터 소스 | Yahoo Finance 비공식 API | FMP API (Professional 플랜) |
| 데이터 저장 | 없음 (매번 실시간 fetch) | `index_prices` 테이블에 일간 데이터 적재 |
| 일간 등락률 계산 | Yahoo API 응답에서 실시간 계산 | DB 저장 데이터 기반 계산 (FMP fallback) |
| 주간 등락률 계산 | Yahoo API 응답에서 실시간 계산 | DB 저장 데이터 기반 계산 |
| Fear & Greed | CNN 비공식 API (유지) | CNN 비공식 API (변경 없음) |
| 사후 검증 | 불가 | 가능 — DB에 이력 보관 |

## 변경 사항

### 1. DB 스키마 — `index_prices` 테이블 추가

`src/db/schema/market.ts`에 추가:
- symbol (^GSPC, ^IXIC, ^DJI, ^RUT, ^VIX)
- date (YYYY-MM-DD)
- open, high, low, close, volume
- unique constraint: (symbol, date)

### 2. ETL — `load-index-prices.ts`

`src/etl/jobs/load-index-prices.ts` 신규 파일:
- FMP `/api/v3/historical-price-full/%5EGSPC` 등 5개 지수 fetch
- 기본 5일, backfill 모드 250일
- 기존 ETL 패턴 준수 (fetchJson, retryApiCall, onConflictDoUpdate)
- 심볼 매핑: FMP는 `%5E` prefix 사용

### 3. `getIndexReturns` 도구 리팩터링

**daily 모드:**
- DB에서 최근 2일 데이터 조회
- 전일 종가 대비 등락률 계산
- DB 데이터 없으면 FMP API 직접 호출 fallback

**weekly 모드:**
- DB에서 최근 7일 데이터 조회
- 주간 시작/종료 종가, 주간 고저, closePosition 계산

**Fear & Greed:** 기존 CNN 소스 유지 (FMP 미제공)

### 4. 테스트

- `load-index-prices.test.ts` — ETL 단위 테스트
- `getIndexReturns.test.ts` — DB 기반 로직 + FMP fallback 테스트

## 작업 계획

1. `index_prices` 스키마 추가 + schema/index.ts export
2. `load-index-prices.ts` ETL 작성
3. `getIndexReturns.ts` 리팩터링 (DB 우선 → FMP fallback)
4. 테스트 작성 (ETL + 도구)
5. README + ROADMAP 업데이트

## 골 정렬

**SUPPORT** — Phase 2 주도섹터/주도주 초입 포착의 직접 기능은 아니지만, 지수 데이터의 안정성과 검증 가능성을 확보하여 리포트 품질 인프라를 강화한다. #417, #419에서 발생한 지수 등락률 오류가 재발하지 않도록 근본 원인을 제거.

## 무효 판정

**해당 없음** — LLM 백테스트, 과적합 등 무효 패턴에 해당하지 않음. 데이터 소스 전환 + ETL 추가는 인프라 개선.

## 리스크

| 리스크 | 대응 |
|--------|------|
| FMP 지수 엔드포인트 응답 형식이 개별 주식과 다를 수 있음 | 기존 load-daily-prices와 동일한 `/api/v3/historical-price-full/` 엔드포인트 사용 |
| ETL 실행 전 에이전트가 실행되면 DB 데이터 없음 | FMP API 직접 호출 fallback 유지 |
| FMP에서 ^VIX 지원 여부 | 비지원 시 VIX만 별도 처리 |
