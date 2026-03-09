# screener 스키마 정리 — market-analyst 자체 스키마로 통합

## 선행 맥락

`docs/features/data-infra/02-decisions.md`에 초기 설계 결정이 기록되어 있다.
당시 결정: "screener 테이블 스키마를 market-analyst에서 재정의 (읽기 전용 표시)".
이유: Phase 판별에서 daily_prices, daily_ma, symbols를 빈번히 조회하므로 타입 안전성이 필수.
screener ETL이 안정적이라 동기화 부담이 적다는 전제가 있었다.

현재(2026-03): screener ETL이 모두 중지. 동기화 전제가 무효화됨.
market-analyst가 해당 테이블의 ETL과 스키마를 모두 소유하는 상황이 사실화됨.

## 골 정렬

SUPPORT — 직접 알파 포착과 무관하지만, 코드베이스 명확성과 유지보수성을 높여
장기적으로 개발 속도를 지원하는 인프라 정리 작업.

## 문제

`src/db/schema/screener.ts`라는 파일 이름이 "screener 프로젝트의 테이블"이라는 오해를 유발한다.
실제로는 market-analyst가 ETL도 실행하고 스키마도 관리하는 완전한 소유 테이블들이다.
파일명과 실소유권의 불일치가 신규 기여자 혼란, 잘못된 import 경로 규칙을 고착화시킨다.

## Before → After

**Before:**
```
src/db/schema/
├── screener.ts   ← "screener 것"이라는 이름. ETL 잡 10개가 직접 import.
├── analyst.ts    ← "market-analyst 것"이라는 이름.
└── index.ts      ← 두 파일 re-export
```

파일 내 테이블 17개가 screener.ts에 혼재:
- market-analyst ETL이 직접 쓰는 테이블 (symbols, dailyPrices, dailyMa, dailyRatios,
  dailyBreakoutSignals, dailyNoiseSignals, quarterlyFinancials, quarterlyRatios) — 8개
- screener 웹앱 전용이나 마이그레이션에 포함된 테이블 (watchlist, trades, tradeActions,
  assetSnapshots, portfolioSettings, accessCodes, priceAlerts, deviceTokens) — 8개
- screener 웹앱 전용이나 market-analyst에서 참조 없음 (위 8개에 포함)

**After:**
```
src/db/schema/
├── market.ts     ← screener.ts 대체. market-analyst가 ETL까지 소유하는 전체 테이블.
├── analyst.ts    ← 변경 없음.
└── index.ts      ← market.ts + analyst.ts re-export
```

- ETL 잡 10개의 import 경로: `"@/db/schema/screener"` → `"@/db/schema/market"`
- `drizzle.config.ts`: `screener.ts` → `market.ts`
- 파일 내 주석: "screener 프로젝트에서 이전한" → "market-analyst가 소유하는"

## 변경 사항

### 1. 파일 생성/삭제

| 변경 | 내용 |
|------|------|
| 신규 | `src/db/schema/market.ts` — screener.ts 내용 그대로 복사 후 주석만 수정 |
| 삭제 | `src/db/schema/screener.ts` |

### 2. import 경로 업데이트 (10개 파일)

| 파일 | 현재 import | 변경 후 |
|------|-------------|---------|
| `src/etl/jobs/load-quarterly-financials.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/cleanup-invalid-symbols.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/load-ratios.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/utils/db.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/load-us-symbols.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/load-daily-prices.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/build-breakout-signals.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/calculate-daily-ratios.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/build-daily-ma.ts` | `@/db/schema/screener` | `@/db/schema/market` |
| `src/etl/jobs/build-noise-signals.ts` | `@/db/schema/screener` | `@/db/schema/market` |

### 3. 설정 파일 업데이트

| 파일 | 변경 내용 |
|------|----------|
| `src/db/schema/index.ts` | `export * from "./screener"` → `export * from "./market"` |
| `drizzle.config.ts` | schema 배열에서 `screener.ts` → `market.ts` |

### 4. 주석/문서 정리

| 파일 | 변경 내용 |
|------|----------|
| `src/db/schema/market.ts` (신규) | 파일 헤더 주석: "Screener 프로젝트에서 이전한 테이블" → "market-analyst가 소유하고 ETL을 관리하는 테이블" |
| `src/etl/utils/validation.ts` line 73 | 주석 내 "screener convention name" 문구 제거 또는 수정 |
| `src/etl/utils/date-helpers.ts` line 25 | 주석 내 "screener ETL jobs" → "market-analyst ETL jobs" |

### 5. 문서 업데이트 (선택)

아래 docs는 과거 맥락 기록이므로 수정하지 않는 것을 권장 (히스토리 보존).
변경이 필요하다면 별도 PR로 분리:
- `docs/overview.md` — screener 참조 3곳
- `README.md` — screener 참조 1곳
- `docs/features/data-infra/` — 설계 결정 기록 (과거 맥락이므로 보존)

## 테이블 분류 상세

### screener.ts 내 테이블 전수 조사

| 테이블 | market-analyst ETL 사용 | 용도 |
|--------|------------------------|------|
| `symbols` | O (5개 잡) | 종목 마스터 — ETL이 갱신, 에이전트가 참조 |
| `quarterlyFinancials` | O (1개 잡) | 재무 데이터 — SEPA 스코어링 기반 |
| `quarterlyRatios` | O (1개 잡) | 분기 밸류에이션 비율 |
| `dailyPrices` | O (1개 잡) | 일간 가격 + RS 스코어 |
| `dailyMa` | O (1개 잡) | 이동평균 — Phase 판별의 핵심 |
| `dailyRatios` | O (1개 잡) | 일간 밸류에이션 |
| `dailyBreakoutSignals` | O (1개 잡) | 돌파 시그널 |
| `dailyNoiseSignals` | O (1개 잡) | VCP/노이즈 지표 |
| `watchlist` | X | screener 웹앱 전용 (개인 관심종목) |
| `trades` | X | screener 웹앱 전용 (매매일지) |
| `tradeActions` | X | screener 웹앱 전용 (매매 실행 기록) |
| `assetSnapshots` | X | screener 웹앱 전용 (자산 스냅샷) |
| `portfolioSettings` | X | screener 웹앱 전용 (포트폴리오 설정) |
| `accessCodes` | X | screener 웹앱 전용 (인증) |
| `priceAlerts` | X | screener 웹앱 전용 (가격 알림) |
| `deviceTokens` | X | screener 웹앱 전용 (푸시 알림) |

**핵심 판단:** 웹앱 전용 8개 테이블도 market.ts에 유지한다.
사유: 이미 마이그레이션(0002)에 포함되어 있고, DB에 실제 테이블이 존재한다.
screener.ts에서 분리하면 외래키(symbols 참조) 때문에 마이그레이션 재구성이 필요하고
Drizzle이 테이블 삭제로 오인할 위험이 있다.
이번 작업의 목표는 "파일명 정리"이며 "테이블 재분류"가 아니다.

## 작업 계획

### Phase 1: 핵심 변경 (단일 브랜치, 단일 PR)

| 단계 | 작업 | 완료 기준 |
|------|------|----------|
| 1 | `src/db/schema/market.ts` 생성 (screener.ts 복사 + 주석 수정) | 파일 생성, 내용 동일, 주석만 변경 |
| 2 | `src/db/schema/screener.ts` 삭제 | 파일 없음 |
| 3 | `src/db/schema/index.ts` 수정 | `screener` → `market` |
| 4 | `drizzle.config.ts` 수정 | schema 배열 경로 변경 |
| 5 | ETL 잡 10개 import 경로 일괄 변경 | 모든 `@/db/schema/screener` → `@/db/schema/market` |
| 6 | 인라인 주석 3곳 정리 (validation.ts, date-helpers.ts, market.ts 헤더) | screener 문구 제거 |
| 7 | TypeScript 컴파일 확인 | `tsc --noEmit` 오류 0건 |
| 8 | 테스트 전체 통과 | `npm test` 오류 0건 |

### 에이전트 배정

단순 기계적 작업이므로 **구현팀 단독** 처리.
- 병렬 불가 (단계 의존성 있음: 파일 생성 → 삭제 → import 수정 순서 필요)
- 코드 리뷰는 `code-reviewer` 에이전트로 진행

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| Drizzle이 screener.ts 삭제를 스키마 변경으로 감지하여 마이그레이션 생성 | LOW | drizzle.config.ts를 screener.ts 삭제 전에 market.ts로 교체하면 Drizzle이 동일 스키마로 인식. 테이블 변경 없으므로 마이그레이션 불필요. `drizzle-kit push`가 아닌 `drizzle-kit generate`를 실행하지 않으면 안전. |
| 누락된 import 경로 | LOW | Grep으로 전수 확인 완료. `@/db/schema/screener` 10개 파일 모두 목록화됨. |
| screener 웹앱이 타입을 직접 import하는 경우 | NONE | screener 웹앱은 별도 프로젝트. 이 레포 코드를 직접 import하지 않음. DB 레벨로만 연결됨. |
| 테스트 import 경로 미반영 | MEDIUM | 테스트 파일에도 screener 참조가 있는지 별도 확인 필요. (현재 조사 범위: `src/` 하위만 확인함) |

**테스트 파일 추가 확인 필요:** `src/` 외 `tests/` 또는 `*.test.ts` 파일에 screener import가 있을 수 있음.
구현 전 `grep -rn "@/db/schema/screener" .` 전수 재확인 권장.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 아래 한 가지는 구현 직전 확인 필요:
- `tests/` 디렉토리의 screener import 여부 (탐색 시 `src/`만 조사했으므로)
  → 구현팀이 `grep -rn "@/db/schema/screener" .` 실행하여 목록 확정 후 진행.
