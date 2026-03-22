# pool.query → Repository 패턴 전환

Issue: #385 | Ref: #211

## 선행 맥락

- #211에서 agent/ 모듈 분리 리팩터링 완료. pool.query 전환은 별도 이슈로 분리됨.
- 현재 DB 접근 패턴이 두 갈래로 분산: Drizzle ORM (51개 파일) vs pool.query raw SQL (41개 파일, 134회 호출).
- `src/db/repositories/` 디렉토리 부재. Repository 레이어가 없는 상태.
- `retryDatabaseOperation` 래퍼가 `src/lib/retry.ts`에 존재. ETL/Tools에서 광범위 사용.
- `safeQuery` 래퍼가 `src/corporate-analyst/loadAnalysisInputs.ts`에 독자 정의 (graceful degradation 용).
- 메모리에 이 주제에 대한 기존 실패/교훈 기록 없음.

## 골 정렬

**SUPPORT** — DB 접근 레이어 표준화는 코드 품질/유지보수성 개선으로, 주도섹터/주도주 포착 골에 간접 기여하는 인프라 리팩터링. 운영 안정성 향상이 실질적 가치.

## 문제

DB 쿼리가 41개 파일에 134회 산재. raw SQL이 비즈니스 로직과 혼재하여 중복 쿼리 증가, 테스트 시 mock 비용 과다, 스키마 변경 시 영향 범위 파악 불가.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| DB 접근 | `pool.query(SQL, params)` 41개 파일에 분산 | `src/db/repositories/`에 집중 |
| 재시도 | 호출부마다 `retryDatabaseOperation(() => pool.query(...))` 래핑 | Repository 내부에서 일괄 처리 |
| 타입 안전 | pool.query<T>로 수동 타입 지정, 런타임 불일치 위험 | Repository 반환 타입으로 컴파일 타임 보장 |
| 테스트 | pool.query를 vi.mock — 쿼리 문자열까지 mock | Repository interface mock — 깔끔한 격리 |
| 쿼리 중복 | 같은 테이블 조회가 여러 파일에 산재 | Repository 메서드로 통합, 재사용 |

## 핵심 설계 결정

### 1. Raw SQL 유지 (Drizzle 전환 아님)

**결정: Repository 내부는 pool.query raw SQL을 그대로 사용한다.**

근거:
- 기존 134회 쿼리 중 상당수가 복잡한 JOIN, LATERAL, CTE, Window 함수 사용. Drizzle ORM으로 표현하면 오히려 가독성 저하.
- Drizzle 전환은 별도 이슈 범위. 이번 목표는 "산재된 쿼리를 한 곳으로 모으는 것"이지 ORM 마이그레이션이 아님.
- Repository 패턴의 핵심 가치는 "접근 위치 집중"이지 "ORM 사용"이 아님.
- 향후 Drizzle 전환 시 Repository 내부만 교체하면 되므로, 이 결정이 미래를 막지 않음.

### 2. 도메인 기반 Repository 분리

테이블 단위가 아닌 도메인/유즈케이스 기반으로 분리한다.

```
src/db/repositories/
├── index.ts                    # barrel export
├── types.ts                    # 공용 타입 (Row 타입, 반환 타입)
├── stockPhaseRepository.ts     # stock_phases 테이블 중심 조회
├── sectorRepository.ts         # sector_rs_daily, industry_rs_daily
├── marketBreadthRepository.ts  # 시장 브레드스 집계 (cross-table)
├── recommendationRepository.ts # recommendations, recommendation_factors
├── priceRepository.ts          # daily_prices, daily_ma, daily_ratios
├── symbolRepository.ts         # symbols 테이블
├── signalRepository.ts         # daily_breakout_signals, daily_noise_signals, signal_log
├── corporateRepository.ts      # company_profiles, annual_financials, analyst_estimates 등 F10 테이블
├── debateRepository.ts         # debate_sessions, theses 조회 (쓰기는 기존 Drizzle store 유지)
└── regimeRepository.ts         # market_regimes 조회 (쓰기는 기존 Drizzle store 유지)
```

분리 기준:
- **하나의 Repository = 하나의 도메인 컨텍스트**. 예: `marketBreadthRepository`는 stock_phases + daily_prices + sector_rs_daily를 조인하지만, "시장 브레드스"라는 단일 관심사.
- 기존 Drizzle ORM 기반 store (thesisStore, regimeStore, sessionStore 등)는 **이번 범위에서 건드리지 않는다**. 이미 Repository 역할을 하고 있으므로 중복 생성 불필요.
- `loadAnalysisInputs.ts`의 16개 쿼리는 corporateRepository로 이동하되, `safeQuery` 패턴(graceful degradation)을 Repository 내부에서 유지.

### 3. scripts/ 디렉토리 제외

`scripts/` (11개 파일)는 일회성 검증/백필 스크립트로, 운영 코드가 아니다. Repository 전환 대상에서 제외한다. 코드 정리 비용 대비 실익 없음.

### 4. 재시도 로직 처리

Repository 내부에 `retryDatabaseOperation`을 포함하지 않는다.

근거:
- 현재 `retryDatabaseOperation`을 사용하는 곳(tools, ETL)과 사용하지 않는 곳(debate/marketDataLoader, agent/dailySendGate)이 혼재.
- 재시도 정책은 호출부의 컨텍스트에 따라 다름 (ETL은 공격적 재시도, 실시간 도구는 빠른 실패 선호).
- Repository는 순수 데이터 접근만 담당. 재시도는 호출부가 결정.
- 다만, **기존 재시도 래핑을 제거하지는 않는다**. 호출부에서 `retryDatabaseOperation(() => repo.getPhase2Stocks(...))` 형태로 유지.

### 5. pool 주입 방식

Repository 함수들은 module-level `pool`을 직접 import한다 (현재 패턴 유지).

근거:
- DI 컨테이너 도입은 과도한 복잡도. 이 프로젝트 규모에 부적합.
- 테스트 시 `vi.mock("@/db/client")`로 pool을 mock하는 기존 패턴이 잘 작동 중.
- 유일한 예외: `loadAnalysisInputs`는 pool을 인자로 받는 구조. 이 패턴은 corporateRepository에서도 유지 (테스트 편의).

## 변경 사항

### 전환 대상 (src/ 내 pool.query 사용 파일, scripts 제외)

| 영역 | 파일 수 | pool.query 횟수 | 대상 Repository |
|------|---------|----------------|-----------------|
| `src/tools/` | 12 | 44 | stockPhase, sector, marketBreadth, recommendation, price, symbol, signal |
| `src/etl/jobs/` | 7 | 25 | stockPhase, sector, recommendation, signal, price |
| `src/agent/` | 5 | 17 | sector, stockPhase, recommendation, marketBreadth |
| `src/corporate-analyst/` | 2 | 18 | corporate (전용) |
| `src/debate/` | 1 | 9 | sector, stockPhase, price, marketBreadth |
| `src/lib/` | 4 | 12 | sector, stockPhase, price |

**총 31개 파일, 125회 pool.query 호출** (테스트 파일 제외)

### 건드리지 않는 것

- `src/debate/thesisStore.ts`, `regimeStore.ts`, `sessionStore.ts` 등 기존 Drizzle 기반 store — 이미 Repository 역할
- `src/lib/reportLog.ts` — Drizzle ORM 사용, pool.query 없음
- `src/db/client.ts` — pool export 유지 (하위 호환)
- `scripts/` — 운영 코드 아님
- `src/db/migrate.ts` — 마이그레이션 전용

## 작업 계획

### Phase 1: 기반 구축 + 고빈도 Repository (stockPhase, sector)

**범위**: 가장 많이 사용되는 2개 Repository 생성 + 관련 파일 전환

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 1-1 | `src/db/repositories/` 디렉토리 생성, `types.ts` (공용 Row 타입), `index.ts` (barrel) | 파일 존재, import 정상 |
| 1-2 | `stockPhaseRepository.ts` 생성 — stock_phases 관련 조회 메서드 추출 | getPhase2Stocks, getPhaseDistribution, getPhaseBySymbolDate 등 |
| 1-3 | `sectorRepository.ts` 생성 — sector_rs_daily, industry_rs_daily 조회 메서드 추출 | getSectorSnapshot, getSectorTransitions, getTopSectors 등 |
| 1-4 | 소비자 전환: `src/tools/getPhase2Stocks.ts`, `getLeadingSectors.ts`, `sectorAlphaGate.ts`, `src/agent/dailySendGate.ts` | pool.query 제거, Repository 호출로 교체, 기존 테스트 통과 |

**예상 영향 파일**: ~8개 (Repository 2 + 소비자 4 + types + index)
**에이전트**: 실행팀 (구현) → 검증팀 (code-reviewer)

### Phase 2: 시장 브레드스 + 가격 Repository

**범위**: 복잡한 cross-table 쿼리가 많은 영역

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 2-1 | `marketBreadthRepository.ts` 생성 — Phase 분포, A/D ratio, 52주 신고가/저가 등 집계 쿼리 | getMarketBreadth (daily/weekly), getAdvanceDecline, getNewHighLow |
| 2-2 | `priceRepository.ts` 생성 — daily_prices 조회 | getPriceHistory, getLatestClose, getPriceChange |
| 2-3 | 소비자 전환: `src/tools/getMarketBreadth.ts` (13회 호출, 가장 많음), `src/debate/marketDataLoader.ts` (9회), `src/lib/priceDeclineFilter.ts`, `src/lib/group-rs.ts` | pool.query 제거, 기존 테스트 통과 |

**예상 영향 파일**: ~8개
**주의**: `getMarketBreadth.ts`는 단일 파일에 13회 pool.query. 쿼리 추출 시 daily/weekly 모드별 메서드 분리 필요.

### Phase 3: 추천 + 시그널 + 심볼 Repository

**범위**: 추천 시스템, 시그널 로그, 심볼 조회

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 3-1 | `recommendationRepository.ts` 생성 — recommendations 조회/저장 | getActiveRecommendations, checkCooldown, getRecommendationFactors |
| 3-2 | `signalRepository.ts` 생성 — signal_log, breakout/noise signals | recordSignal, getSignalReturns |
| 3-3 | `symbolRepository.ts` 생성 — symbols 테이블 조회 | getActiveSymbols, getSymbolDetail |
| 3-4 | 소비자 전환: `src/tools/saveRecommendations.ts` (9회), `src/tools/getStockDetail.ts` (5회), `src/tools/getUnusualStocks.ts`, `src/tools/getRisingRS.ts`, `src/tools/getPhase1LateStocks.ts`, `src/tools/getFundamentalAcceleration.ts`, `src/tools/bearExceptionGate.ts` (3회) | pool.query 제거, 기존 테스트 통과 |

**예상 영향 파일**: ~12개

### Phase 4: ETL + Agent + Corporate

**범위**: 나머지 전환 (ETL jobs, agent, corporate-analyst, lib 잔여)

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 4-1 | `corporateRepository.ts` 생성 — F10 테이블 (company_profiles, annual_financials 등) 16개 쿼리 | loadAnalysisInputs의 safeQuery 패턴 보존, pool 인자 주입 유지 |
| 4-2 | ETL 소비자 전환: `build-stock-phases.ts` (8회), `detect-sector-phase-events.ts` (4회), `validate-data.ts` (7회), `update-signal-returns.ts`, `record-new-signals.ts`, `track-phase-exits.ts`, `update-recommendation-status.ts` | pool.query 제거, 기존 테스트 통과 |
| 4-3 | Agent 소비자 전환: `dailyQA.ts`, `debateQA.ts`, `run-weekly-qa.ts`, `run-corporate-analyst.ts`, `dailySendGate.ts` (Phase 1에서 미전환 부분) | pool.query 제거 |
| 4-4 | Lib 잔여 전환: `crossReportValidator.ts`, `sectorLagStats.ts` | pool.query 제거 |
| 4-5 | `src/tools/saveReportLog.ts` 전환 (단순 INSERT 1회) | pool.query 제거 |
| 4-6 | 최종 검증: `grep -r "pool.query" src/` 결과가 0건 (테스트 파일 및 client.ts 제외) | 잔존 pool.query 없음 |

**예상 영향 파일**: ~18개
**주의**: `validate-data.ts`(7회)와 `build-stock-phases.ts`(8회)는 쿼리가 많으므로 주의 깊은 추출 필요.

### Phase 5: 테스트 정비 + 정리

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 5-1 | 기존 테스트의 pool.query mock을 Repository mock으로 전환 | 모든 테스트 통과, mock 대상이 Repository |
| 5-2 | Repository 단위 테스트 추가 (주요 메서드) | 커버리지 80% 이상 |
| 5-3 | `pool` export 정리 — `src/db/client.ts`에서 pool export를 `@deprecated` 마킹 | deprecated 주석 추가 |

## Phase별 PR 전략

| Phase | 예상 PR 크기 | 리뷰 난이도 |
|-------|-------------|------------|
| 1 | ~300 lines | 낮음 — 패턴 확립, 소수 파일 |
| 2 | ~400 lines | 중간 — 복잡 쿼리 추출 |
| 3 | ~500 lines | 중간 — 파일 수 많지만 패턴 반복 |
| 4 | ~600 lines | 높음 — ETL/corporate 특수 패턴 |
| 5 | ~300 lines | 낮음 — 테스트 정비 |

각 Phase는 독립 브랜치 + 독립 PR. Phase 간 의존성은 순차적 (1→2→3→4→5).

## 리스크

| 리스크 | 심각도 | 완화 |
|--------|--------|------|
| 운영 파이프라인 장애 | 높음 | Phase별 PR로 점진 배포. 각 Phase 후 1일 운영 확인 후 다음 Phase 진행 |
| 쿼리 결과 불일치 | 높음 | Repository 메서드 생성 시 기존 SQL을 그대로 복사. 변환/최적화 금지. 기존 테스트가 regression guard |
| PR 크기 과다 | 중간 | 한 Phase 내에서도 sub-PR 분리 가능 (예: Phase 4는 ETL/Agent/Corporate 각각 PR) |
| 테스트 mock 대량 수정 | 중간 | Phase 5에서 일괄 처리. Phase 1~4에서는 기존 mock 패턴 유지 가능 (Repository가 내부적으로 pool.query 사용하므로) |
| retryDatabaseOperation 누락 | 낮음 | 호출부의 기존 retry 래핑을 제거하지 않음. Repository 도입이 기존 재시도 동작을 변경하지 않음 |

## 의사결정 필요

없음 — 바로 구현 가능.

설계 결정 5건(raw SQL 유지, 도메인 기반 분리, scripts 제외, 재시도 호출부 유지, pool 직접 import)은 코드베이스 분석 근거에 기반하여 자율 판단 완료.
