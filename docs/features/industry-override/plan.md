# Plan: FMP 업종 오분류 보정 — Industry Override 시스템

## 문제 정의

FMP API의 업종(industry) 분류가 일부 종목에서 실제 사업과 불일치한다.
- SNDK(NAND 플래시): FMP `Hardware, Equipment & Parts` → 실제 `Semiconductors`
- `load-us-symbols.ts`의 upsert가 매 실행 시 FMP 원본으로 덮어쓰므로 수동 보정 불가

**영향**: SNDK가 약세 업종(RS 59.9, Phase 3)으로 잘못 귀속되어, Semiconductors(RS 69.5, Phase 2) 분석에서 누락됨. 업종 RS 기반 Phase 2 초입 포착의 정확도를 직접 훼손.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| SNDK 업종 RS | Hardware (RS 59.9, Phase 3) | Semiconductors (RS 69.5, Phase 2) |
| symbols 테이블 | FMP 원본만 보존 | FMP 원본 보존 (변경 없음) |
| 업종 보정 | 불가능 | override 테이블로 보정 |
| 업종 RS 계산 | `s.industry` 직접 참조 | `COALESCE(sio.industry, s.industry)` |

## 골 정렬

**ALIGNED** — Phase 2 초입 포착 정확도의 직접 개선. 업종 오분류는 업종 RS 게이트를 왜곡하여 포착·탈락 판정을 오염시킨다.

## 무효 판정

없음. 오분류가 실제로 확인된 구체적 케이스(SNDK)가 있고, 수정 범위가 명확하다.

## 설계

### 1. `symbol_industry_overrides` 테이블

```sql
CREATE TABLE symbol_industry_overrides (
  symbol TEXT PRIMARY KEY REFERENCES symbols(symbol),
  industry TEXT NOT NULL,
  original_industry TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- symbols 테이블의 FMP 원본은 절대 수정하지 않음
- override는 별도 레이어로 적용

### 2. 조회 패턴

`symbols.industry`를 참조하는 모든 쿼리에 일관된 패턴 적용:

```sql
LEFT JOIN symbol_industry_overrides sio ON s.symbol = sio.symbol
-- SELECT/GROUP BY/WHERE에서:
COALESCE(sio.industry, s.industry) -- override 우선, 없으면 FMP 원본
```

### 3. 영향 범위 분류

**A. RS 계산 (최우선)** — `groupRsRepository.ts`
- `findGroupAvgs()` — industry별 RS 평균 계산
- `findGroupBreadth()` — industry별 브레드스 지표
- `findGroupTransitions()` — Phase 전환 수
- `findGroupFundamentals()` — 펀더멘탈 비율
- 이 4개 함수가 `ALLOWED_GROUP_COLS.industry.col`로 `s.industry`를 참조
- `joinClause` 필드를 추가하여 LEFT JOIN을 동적 주입

**B. 종목 조회/표시** — `stockPhaseRepository.ts`
- `findPhase2Stocks()`, `findAllPhase2Stocks()` — SELECT `s.industry`
- `findUnusualStocks()` — SELECT + WHERE 필터
- `findRisingRsStocks()`, `findPhase1LateStocks()` — SELECT `s.industry`
- `findActiveNonEtfSymbols()` — SELECT + WHERE 필터
- `countNullIndustrySymbols()` — WHERE 필터
- `findPhase2RatioForQa()` — WHERE 필터
- `findPhase1to2Transitions()` — SELECT `sym.industry`

**C. 메타데이터 조회**
- `symbolRepository.ts` — `findSymbolMeta()`
- `corporateRepository.ts` — `findSymbolInfo()`
- `fundamentalRepository.ts` — `findFundamentalAccelerations()`

**D. 변경 불필요** — `industry_rs_daily` 테이블에서 직접 읽는 쿼리들
- `sectorRepository.ts`의 대부분 함수 (이미 계산된 RS 데이터 참조)
- `groupRsRepository.ts`의 `findGroupHistoricalRs()`, `findGroupPrevPhases()`

## 작업 계획

### Phase 1: DB 스키마
1. SQL 마이그레이션 `0033_symbol_industry_overrides.sql` 생성
2. Drizzle 스키마 `market.ts`에 `symbolIndustryOverrides` 테이블 추가

### Phase 2: groupRsRepository 수정
- `ALLOWED_GROUP_COLS`에 `joinClause` 필드 추가
- industry의 경우 `LEFT JOIN symbol_industry_overrides sio ON s.symbol = sio.symbol` 주입
- `col`을 `COALESCE(sio.industry, s.industry)`로 변경
- 4개 함수에 joinClause 삽입

### Phase 3: stockPhaseRepository 수정
- 9개 함수에 LEFT JOIN + COALESCE 적용
- WHERE 필터의 `s.industry`도 COALESCE로 교체

### Phase 4: 기타 리포지토리 수정
- symbolRepository, corporateRepository, fundamentalRepository

### Phase 5: 초기 데이터
- SNDK → Semiconductors 시드 마이그레이션에 포함

### Phase 6: 테스트
- override 있는/없는 종목의 industry 조회 정확성 테스트
- groupRsRepository의 동적 SQL 생성 검증

## 리스크

1. **COALESCE JOIN 누락**: 하나라도 빠지면 해당 경로에서 원본 industry 사용 → 불일치. 전수 탐색 완료 후 체크리스트로 관리.
2. **성능**: LEFT JOIN 추가로 미미한 오버헤드. override 테이블은 소수 행(< 100)이므로 무시 가능.
3. **소급 반영**: 기존 `industry_rs_daily` 데이터는 변경되지 않음. 다음 ETL 실행부터 반영.
