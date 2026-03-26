# Plan: SPAC(Shell Companies) 필터링

## 문제 정의

SPAC(Special Purpose Acquisition Company)이 ETL 파이프라인에서 필터링되지 않아 Phase 2 오판 및 섹터 RS 왜곡 발생.
- DB 내 Shell Companies: 164개
- Phase 2 오판된 SPAC: 53개
- Financial Services 섹터 RS 계산 오염

SPAC은 NAV ~$10 근처에서 미세한 변동만으로도 기술적 Phase 2 조건 충족 → 가짜 시그널 발생.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 심볼 로딩 | ETF/Fund만 제외 | ETF/Fund + Shell Companies 제외 |
| Phase 빌드 쿼리 | ETF만 제외 | ETF/Fund + Shell Companies 제외 |
| QA/검증 쿼리 | ETF/Fund 제외 | ETF/Fund + Shell Companies 제외 |
| 기존 SPAC 데이터 | 활성 상태 | is_actively_trading = false 처리 |

## 변경 사항

### 1. `src/etl/jobs/load-us-symbols.ts`
- 필터에 `industry !== 'Shell Companies'` 추가 (유입 차단)

### 2. `src/db/repositories/stockPhaseRepository.ts`
- `findActiveNonEtfSymbols`: `is_fund = false` + `industry != 'Shell Companies'` 추가
- `countNullIndustrySymbols`: `is_fund = false` + `industry != 'Shell Companies'` 추가
- `findUnusualStocks`: `industry != 'Shell Companies'` 추가
- `findPhase2RatioForQa`: `industry != 'Shell Companies'` 추가

### 3. 기존 데이터 정리
- 마이그레이션 스크립트: DB 내 Shell Companies 심볼의 `is_actively_trading = false` 처리

## 골 정렬

**ALIGNED** — Phase 2 주도섹터/주도주 초입 포착의 정확도를 직접 개선. SPAC 오판 제거로 Financial Services 섹터 RS 정상화.

## 무효 판정

해당 없음. 데이터 필터링은 LLM 백테스트/프롬프트 튜닝과 무관한 ETL 레벨 버그 수정.

## 리스크

- **낮음**: FMP `industry = 'Shell Companies'` 분류는 공식 분류이며 오탐 0
- 기존 SPAC 데이터를 비활성화하므로, 다음 ETL 사이클에서 자동 정리됨
