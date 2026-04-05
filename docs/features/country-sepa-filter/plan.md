# country-sepa-filter

## 선행 맥락

없음 — 이 주제에 대한 이전 결정/교훈 기록 없음.

---

## 골 정렬

**ALIGNED** — 스크리닝 도구가 외국 종목과 C/F 등급 종목을 에이전트에게 노출하면, 에이전트가 없는 SEPA 데이터를 추론하거나 등급을 hallucination한다. 이는 Phase 2 초입 포착 정확도를 직접 훼손한다. 필터 교정은 에이전트의 입력 품질을 높이는 인프라 수정이다.

---

## 문제

`runFundamentalValidation.ts`의 스코어링 대상은 `symbols.country = 'US'`로 미국 종목만이지만, 스크리닝 도구 3종(`get_phase2_stocks`, `get_phase1_late_stocks`, `get_rising_rs`)은 country 필터가 없어 외국 종목도 반환한다. 또한 `fundamental_scores.grade` 필터도 없어 C/F 등급 종목도 에이전트에게 노출된다.

결과:
- 외국 종목(EQNR=노르웨이, TEN=중국 ADR 등)이 Phase 2 + RS 95 후보로 올라오지만 SEPA 스코어 없음 → "SEPA 미확인" 표시
- C/F 등급 종목(UCTT, FET, PARR)이 올라와 에이전트가 등급을 hallucination (C등급 → "B등급"으로 잘못 판단)

---

## Before → After

**Before**: 스크리닝 도구가 `symbols JOIN`만 하고 country/grade 필터 없이 모든 종목 반환. 에이전트가 SEPA 미확인 종목과 C/F 등급 종목을 받아서 직접 처리.

**After**: 스크리닝 도구가 `fundamental_scores INNER JOIN`으로 S/A 등급 미국 종목만 반환. 에이전트는 처음부터 게이트를 통과한 종목만 본다. hallucination 원인 원천 차단.

---

## 변경 사항

### 변경 대상: `src/db/repositories/stockPhaseRepository.ts`

3개 함수(`findPhase2Stocks`, `findRisingRsStocks`, `findPhase1LateStocks`)의 SQL에 동일한 패턴의 필터를 추가한다.

#### JOIN 방식 결정: INNER JOIN (scored_date 최신 레코드)

`fundamental_scores`는 스코어링 실행일(`scored_date`) 기준으로 레코드가 쌓인다.
하나의 종목에 대해 scored_date별로 여러 레코드가 존재하므로, 최신 스코어를 단일 레코드로 가져오는 서브쿼리 패턴을 사용한다.

기존 `fundamentalRepository.ts`의 `findFundamentalGrades` 패턴(`DISTINCT ON (symbol) ... ORDER BY symbol, scored_date DESC`)을 재사용한다.

**INNER JOIN을 선택하는 이유:**
- `fundamental_scores`에 없는 종목 = SEPA 스코어가 없는 종목 (외국 종목, 실적 데이터 미확보 종목 포함)
- 스코어 없는 종목을 NULL로 포함시키는 것(LEFT JOIN)은 이슈의 핵심 원인
- INNER JOIN으로 스코어 있는 종목만 통과시키는 것이 의도에 부합

**신규 종목 엣지 케이스:**
- 신규 상장 종목은 `quarterly_financials`가 없어 `getAllScoringSymbols`에서 제외됨 → `fundamental_scores`에도 없음
- INNER JOIN이면 이 종목들은 스크리닝에서 제외됨
- 이는 의도된 동작이다. SEPA 스코어가 없으면 에이전트가 판단할 근거가 없으므로 제외가 맞다.

#### 추가할 서브쿼리 패턴 (3개 함수 공통)

```sql
-- 최신 fundamental_scores 서브쿼리 (CTE 또는 인라인 서브쿼리로 추가)
WITH latest_scores AS (
  SELECT DISTINCT ON (symbol) symbol, grade
  FROM fundamental_scores
  ORDER BY symbol, scored_date DESC
)
```

그리고 기존 `JOIN symbols s ON sp.symbol = s.symbol` 아래에:

```sql
JOIN latest_scores fs ON fs.symbol = sp.symbol
  AND fs.grade IN ('S', 'A')
```

country 필터는 symbols 테이블을 이미 JOIN하므로 WHERE절에 추가:

```sql
AND s.country = 'US'
```

### 함수별 변경 상세

#### `findPhase2Stocks`

현재 구조:
```sql
SELECT sp.symbol, ...
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
WHERE sp.date = $1
  AND sp.phase = 2
  AND sp.rs_score >= $2
  AND sp.rs_score <= $3
  AND s.market_cap::numeric >= $5
ORDER BY sp.rs_score DESC
LIMIT $4
```

변경 후:
```sql
WITH latest_scores AS (
  SELECT DISTINCT ON (symbol) symbol, grade
  FROM fundamental_scores
  ORDER BY symbol, scored_date DESC
)
SELECT sp.symbol, ...
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
JOIN latest_scores fs ON fs.symbol = sp.symbol
WHERE sp.date = $1
  AND sp.phase = 2
  AND sp.rs_score >= $2
  AND sp.rs_score <= $3
  AND s.market_cap::numeric >= $5
  AND s.country = 'US'
  AND fs.grade IN ('S', 'A')
ORDER BY sp.rs_score DESC
LIMIT $4
```

#### `findRisingRsStocks`

현재 구조: rs_4w CTE 이미 존재. `latest_scores` CTE를 추가하고 JOIN + WHERE 조건 추가.

```sql
AND s.country = 'US'
AND fs.grade IN ('S', 'A')
```

JOIN:
```sql
JOIN latest_scores fs ON fs.symbol = sp.symbol
```

#### `findPhase1LateStocks`

현재 구조: trading_boundary CTE 이미 존재. `latest_scores` CTE를 추가하고 JOIN + WHERE 조건 추가.

동일 패턴 적용.

### 반환 타입 변경 없음

필터만 추가하는 것이므로 `StockPhaseRow`, `RisingRsStockRow`, `Phase1LateStockRow` 타입 변경 없음.
도구 레이어(`getPhase2Stocks.ts` 등)도 변경 불필요.

---

## 작업 계획

| 단계 | 작업 내용 | 에이전트 | 완료 기준 |
|------|-----------|---------|----------|
| 1 | `stockPhaseRepository.ts` — `findPhase2Stocks` SQL에 `latest_scores` CTE + JOIN + `country = 'US'` + `grade IN ('S', 'A')` 추가 | 구현 | SQL 구문 오류 없음 |
| 2 | `stockPhaseRepository.ts` — `findRisingRsStocks` 동일 패턴 적용 | 구현 | SQL 구문 오류 없음 |
| 3 | `stockPhaseRepository.ts` — `findPhase1LateStocks` 동일 패턴 적용 | 구현 | SQL 구문 오류 없음 |
| 4 | 테스트 실행 | 검증 | 기존 테스트 통과 + 신규 테스트 통과 |

---

## 테스트 계획

**기존 테스트 확인:**
```bash
yarn vitest run src/tools/
```

**신규 단위 테스트 — 검증할 케이스:**

1. `findPhase2Stocks` — S등급 미국 종목이 결과에 포함되는지
2. `findPhase2Stocks` — C등급 종목이 결과에서 제외되는지
3. `findPhase2Stocks` — country = 'NO'(노르웨이) 종목이 제외되는지
4. `findPhase2Stocks` — `fundamental_scores`에 레코드가 없는 종목이 제외되는지 (INNER JOIN 동작 확인)
5. `findRisingRsStocks` — 동일 케이스
6. `findPhase1LateStocks` — 동일 케이스

테스트는 DB 모킹 또는 실 DB에서 테스트 픽스처로 검증한다.

**수동 검증 (로컬 스크립트):**

```bash
# 오늘 날짜 기준으로 각 도구 실행 후, 결과에 외국 종목/C/F 등급 없는지 확인
npx tsx -e "
  import { findPhase2Stocks } from './src/db/repositories/stockPhaseRepository.js';
  const rows = await findPhase2Stocks({ date: '2026-04-04', minRs: 60, maxRs: 95, limit: 50 });
  console.log(rows.map(r => r.symbol));
"
```

---

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| fundamental_scores 스코어링 지연 시 당일 결과가 줄어듦 | 낮음 | SEPA 스코어링은 매주 실행되므로 scored_date가 최대 1주 지연. 영향 미미. 기존에도 최신 스코어 기준으로 쿼리함. |
| INNER JOIN으로 신규 상장 종목이 누락 | 낮음 | 의도된 동작. SEPA 실적 없는 종목 = 판단 불가. |
| country 컬럼이 NULL인 미국 종목 누락 | 중간 | `getAllScoringSymbols`는 `country IS NULL`도 허용하지만 스크리닝에서는 `country = 'US'`만 허용. country = NULL인 미국 종목이 실제로 있는지 사전 확인 필요. |

**리스크 3 사전 확인 쿼리 (구현 전 실행 권장):**
```sql
SELECT COUNT(*) FROM symbols
WHERE is_actively_trading = true
  AND country IS NULL
  AND symbol IN (SELECT DISTINCT symbol FROM fundamental_scores);
```

결과가 0이면 안전. 양수면 `AND (s.country = 'US' OR s.country IS NULL)` 패턴 사용 (`getAllScoringSymbols`와 동일).

---

## 의사결정 필요

없음 — country NULL 처리는 구현 전 위 사전 확인 쿼리로 매니저가 자율 판단 가능.
