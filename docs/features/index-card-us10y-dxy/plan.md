# Plan: 지수 카드에 US10Y/DXY 추가

> Closes #658 | Lite 트랙

## 문제 정의

섹터 RS 테이블만으로는 "왜 이 섹터가 강한가"의 매크로 맥락이 부재.
US10Y(미국 10년 국채 금리)와 DXY(달러 인덱스)는 섹터 로테이션의 핵심 드라이버:
- 금리 하락 → 성장주(Tech, Consumer Discretionary) 강세
- 금리 상승 → 가치주(Energy, Financials) 강세
- 달러 약세 → EM/원자재 강세

이 맥락이 일간 리포트 지수 카드에 포함되면 에이전트와 사용자 모두 섹터 RS 변동의 원인을 추론할 수 있다.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 지수 카드 | S&P 500, NASDAQ, DOW 30, Russell 2000, VIX (5개) | + US 10Y, DXY (7개) |
| 섹터 로테이션 맥락 | 없음 (DXY는 "실시간 조회 불가 지표" 목록) | 금리/달러 방향 데이터 제공 |
| ETL 수집 | 5개 심볼 | 7개 심볼 |

## 골 정렬

- **ALIGNED** — 프로젝트 골은 "주도섹터/주도주 발굴". 금리/달러는 섹터 로테이션의 핵심 드라이버이므로 분석 품질 직접 향상.

## 무효 판정

- **VALID** — FMP Professional 플랜에서 `^TNX`, `DX-Y.NYB` 모두 조회 가능. 기존 index_prices 테이블이 심볼 비의존적 구조이므로 DB 스키마 변경 불필요.

## 변경 사항

### 1. ETL: `src/etl/jobs/load-index-prices.ts`
- `INDEX_SYMBOLS` 배열에 US10Y/DXY 추가
- FMP 심볼: `%5ETNX` (^TNX), `DX-Y.NYB`

### 2. 도구: `src/tools/getIndexReturns.ts`
- `INDEX_SYMBOLS` 맵에 `"^TNX": "US 10Y"`, `"DX-Y.NYB": "DXY"` 추가
- `FMP_SYMBOL_MAP`에 URL 인코딩 심볼 추가
- 도구 description 업데이트 (US 10Y, DXY 언급)

### 3. 렌더링: `src/lib/daily-html-builder.ts`
- US10Y 전용 카드: 종가를 `X.XX%` 형식, 변화량을 `±Xbp` (basis point) 단위 표시
- DXY 전용 카드: 종가 그대로, 변화량에 포인트+% 표시
- 색상: 표준 색상 (상승=빨강, 하락=파랑). 의미 해석은 사용자 몫.

### 4. 토론: `src/debate/marketDataLoader.ts`
- `INDEX_SYMBOL_NAMES`에 US10Y/DXY 추가

### 5. 프롬프트: `src/agent/prompts/daily.ts`
- "실시간 조회 불가 지표" 목록에서 DXY 제거

### 6. 테스트
- ETL 테스트: 심볼 수 5→7 반영
- getIndexReturns 테스트: 새 심볼 포함 검증

## 리스크

| 리스크 | 대응 |
|--------|------|
| FMP에서 ^TNX/DX-Y.NYB 심볼이 다를 수 있음 | FMP Professional 플랜 확인 완료. 실패 시 해당 심볼만 skip (기존 에러 핸들링) |
| US10Y 종가가 yield(%) 값이라 changePercent가 오해될 수 있음 | HTML에서 bp 단위로 별도 렌더링 |
| 기존 5개 지수 동작에 영향 | 추가만 하고 기존 구조 변경 없음. 하위 호환 유지 |

## 작업 순서

1. ETL 심볼 추가
2. getIndexReturns 도구 확장
3. HTML 렌더러 특수 카드 추가
4. marketDataLoader 심볼 추가
5. 프롬프트 업데이트
6. 테스트 업데이트
7. README/ROADMAP 업데이트
