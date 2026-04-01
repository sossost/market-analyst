# Plan: SEPA 스코어러 Non-GAAP EPS 적용

**이슈:** #557
**유형:** Lite (기존 파이프라인 개선, 신규 아키텍처 아님)
**골 정렬:** ALIGNED — SEPA 스코어링 정확도 직접 개선 → thesis 적중률(1번 KPI) 기여

## 문제 정의

FMP `/stable/income-statement`가 `epsDilutedNonGAAP`, `adjustedEPS` 필드를 반환하지 않아,
`quarterly_financials.eps_diluted`가 항상 GAAP 기준으로 적재됨.

시장은 Non-GAAP EPS 기준으로 반응하므로, GAAP만 사용하는 SEPA 스코어러는
LASR 같은 Non-GAAP 흑자 전환 성장주를 구조적으로 과소평가함.

**LASR 사례:**
| 기준 | 2025Q4 EPS |
|------|-----------|
| GAAP (`quarterly_financials`) | -$0.10 |
| Non-GAAP (`eps_surprises`) | +$0.14 |

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| SEPA EPS 소스 | `quarterly_financials.eps_diluted` (GAAP only) | `eps_surprises.actual_eps` (Non-GAAP) 우선, GAAP 폴백 |
| eps_surprises 적재 범위 | Phase 2 RS≥70 OR vol≥1.5 + watchlist | **Phase 2 전체** + watchlist |
| 적재 종목 수 | ~200–400 | ~1,400 |

## 변경 사항

### 1. eps_surprises ETL 적재 범위 확대
- `load-earnings-surprises-fmp.ts`의 `fetchTargetSymbols()` 수정
- RS/vol 필터 제거 → Phase 2 전체 종목 대상
- CONCURRENCY 8→4, PAUSE_MS 100→150 (종목 증가에 따른 레이트리밋 대응)

### 2. 분기 매핑 유틸 추가
- `quarter-utils.ts`에 `reportDateToAsOfQ(actualDate: string): string` 추가
- 어닝 발표일 → 보고 분기 매핑 (발표일이 속한 분기의 직전 분기)
  - 1~3월 발표 → Q4 전년, 4~6월 → Q1, 7~9월 → Q2, 10~12월 → Q3

### 3. fundamental-data-loader.ts 수정
- `loadFundamentalData()`에서 eps_surprises 별도 조회
- `mergeEpsSurprises()` 함수 추가: 발표일→분기 매핑 후 QuarterlyData에 actualEps 병합
- `QuarterlyData` 타입에 `actualEps: number | null` 필드 추가

### 4. fundamental-scorer.ts Non-GAAP 우선 로직
- `getEps(q: QuarterlyData): number | null` 헬퍼 추가 — `actualEps ?? epsDiluted`
- `evaluateEpsGrowth`, `evaluateEpsAcceleration`에서 `getEps()` 사용
- detail 문자열에 Non-GAAP 사용 여부 표시

## 작업 계획

1. `quarter-utils.ts`에 `reportDateToAsOfQ` 추가 + 테스트
2. `QuarterlyData` 타입에 `actualEps` 필드 추가
3. `fundamental-data-loader.ts`에 eps_surprises 로딩/머지 추가 + 테스트
4. `fundamental-scorer.ts`에 `getEps()` 헬퍼 적용 + 테스트
5. `load-earnings-surprises-fmp.ts` 적재 범위 확대 + 테스트 업데이트
6. README.md, docs/ROADMAP.md 문서 업데이트

## 리스크

1. **분기 매핑 오차**: 극소수 종목의 비표준 회계연도(1~3월 결산)에서 매핑 오류 가능.
   → 대부분 12월 결산이므로 실질 영향 미미. 폴백(GAAP)이 존재하므로 안전.

2. **API 호출량 증가**: ~1,400종목 개별 호출. FMP Professional 플랜 내 허용 범위.
   → CONCURRENCY 4 + 150ms 간격으로 약 5분 소요. 기존 ETL 스케줄에 포함 가능.

3. **기존 스코어 변화**: Non-GAAP 적용 후 일부 종목의 SEPA 등급이 변동됨.
   → 의도된 동작. 다음 실행부터 자동 반영, 기존 데이터 재계산 불필요.

## 무효 판정

무효 사유 없음. 기존 파이프라인의 데이터 소스를 개선하는 변경으로,
시스템의 핵심 가치(SEPA 스코어링 정확도)를 직접 향상시킴.
