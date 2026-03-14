# SEPA 데이터 품질 방어 — 이슈 #217

## 선행 맥락

- **PR #200**: bull-bias 프롬프트 강화 + QA warn 확대 + `clampPercent` null 반환 구현 완료. 이번 이슈와 무관.
- **2026-03-14 발생**: SMFG(Sumitomo Mitsui Financial Group, 일본 은행 NYSE ADR)가 SEPA S등급(100점)으로 판정 → 종목 리포트 자동 발행 → Discord 발송. CEO가 리포트에서 직접 발견.

---

## 골 정렬

**ALIGNED** — 직접 기여.

프로젝트 골(Phase 2 미국 시장 주도주 포착)에서 오염 데이터로 산출된 가짜 S등급은 리포트 신뢰도를 직접 훼손한다.

---

## 문제

이슈 #217에서 식별된 4가지 문제:

### 1. FMP 누적 vs 단독 분기 혼재

일본 기업(회계연도 4~3월)의 경우 FMP가 누적 실적을 단독 분기처럼 제공:

| 분기 | 매출 | 문제 |
|------|------|------|
| 2025Q4 (12월) | ¥7.93조 | 9개월 누적 (4~12월) |
| 2025Q3 (9월) | ¥2.66조 | 단독 분기 |
| 2024Q4 (12월) | ¥2.40조 | 단독 or 누적 불명 |

→ YoY 비교 시 7.93조 vs 2.40조 = **+230%** (실제 성장이 아님)

### 2. 통화 불일치

FMP가 SMFG 실적을 JPY로 반환하는데, 시스템이 USD로 간주:
- EPS ¥362.51 → $362.51로 인식
- 주가 $20.08과 비교 → PE 2.09 (가짜)

### 3. 순이익 단위 불연속

| 기간 | 순이익 |
|------|--------|
| 2023Q2~Q4 | 1.8B~1.9B (십억 단위) |
| 2024Q1~ | 42B~556B (수백억 단위) |

→ 2~3자릿수 점프. EPS YoY +247%의 원인.

### 4. SEPA 스코어러 방어 로직 부재

`fundamental-scorer.ts`가 입력 데이터를 그대로 신뢰:
- 분기간 매출/이익 급변(>5x) 감지 없음
- 누적 실적 판별 없음
- 비미국 기업 필터 없음

---

## 원인 분석

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/agent/fundamental/runFundamentalValidation.ts` | L319-328 (`getAllScoringSymbols`) | `WHERE s.is_actively_trading = true`만 필터. country 필터 없어 JP 종목 포함 |
| `src/lib/fundamental-scorer.ts` | L25-54 (`scoreFundamentals`) | 입력 데이터 sanity check 없음. 분기 간 급변 감지 없음 |
| `src/lib/fundamental-data-loader.ts` | L26-47 | 통화/누적 여부 구분 없이 숫자 그대로 로드 |

**핵심 진입점 2곳:**
1. `getAllScoringSymbols()` — 비미국 종목을 걸러내지 않음 (1차 방어 부재)
2. `scoreFundamentals()` — 비정상 데이터를 감지하지 않음 (2차 방어 부재)

---

## Before → After

**Before:**

```sql
-- getAllScoringSymbols (L319-328)
SELECT DISTINCT f.symbol
FROM quarterly_financials f
JOIN symbols s ON f.symbol = s.symbol
WHERE s.is_actively_trading = true
ORDER BY f.symbol
```

```typescript
// scoreFundamentals (L25-54) — 방어 로직 없음
export function scoreFundamentals(input: FundamentalInput): FundamentalScore {
  const { symbol, quarters } = input;
  if (quarters.length < MIN_QUARTERS_REQUIRED) {
    return makeInsufficientDataScore(symbol);
  }
  // 바로 평가 진입 — 데이터 품질 검증 없음
```

**After:**

```sql
-- getAllScoringSymbols — country 필터 추가
SELECT DISTINCT f.symbol
FROM quarterly_financials f
JOIN symbols s ON f.symbol = s.symbol
WHERE s.is_actively_trading = true
  AND (s.country = 'US' OR s.country IS NULL)
ORDER BY f.symbol
```

```typescript
// scoreFundamentals — sanity check 추가
export function scoreFundamentals(input: FundamentalInput): FundamentalScore {
  const { symbol, quarters } = input;
  if (quarters.length < MIN_QUARTERS_REQUIRED) {
    return makeInsufficientDataScore(symbol);
  }

  // 데이터 품질 sanity check — 분기 간 급변 감지
  if (hasQuarterlyAnomaly(quarters)) {
    return makeAnomalyScore(symbol);
  }
  // ... 이하 기존 로직
```

---

## 접근 옵션 비교

| 항목 | 접근 1 (채택) | 접근 2 |
|------|--------------|--------|
| 방법 | country 필터(1차) + sanity check(2차) 이중 방어 | ETL에서 reportedCurrency 저장 + 통화 기반 필터 |
| 변경 규모 | SQL 1줄 + 순수 함수 1개 추가 | DB 마이그레이션 + ETL 수정 + 기존 데이터 재ETL |
| 효과 | 비미국 기업 차단 + 미국 기업 중 이상치도 감지 | 정밀하나 과도 |
| 단점 | TSM 등 비미국 우량주 제외 | 복잡도 증가 |
| 프로젝트 골 | 미국 시장 주도주 → 비미국 제외 합리적 | 범용이나 현재 골과 미스매치 |

**접근 1 채택 사유**: 이중 방어로 비미국 기업(1차)과 미국 기업 중 이상 데이터(2차)를 모두 잡는다. 업종별 지표 적합성(은행에 EBITDA 등)은 후속 이슈로 분리.

---

## 변경 사항

### 1. 스코어링 대상 필터 (1차 방어) — `runFundamentalValidation.ts`

`getAllScoringSymbols()` (L319-328) SQL에 country 필터 추가:

```typescript
WHERE s.is_actively_trading = true
  AND (s.country = 'US' OR s.country IS NULL)
```

`country IS NULL`은 country 미입력 기존 데이터를 보수적으로 포함.

### 2. 분기 급변 감지 (2차 방어) — `fundamental-scorer.ts`

`scoreFundamentals()` 진입부에 `hasQuarterlyAnomaly()` sanity check 추가:

```typescript
/**
 * 분기 간 매출/순이익이 5배 이상 급변하면 데이터 이상으로 판단.
 * 누적 보고, 통화 불일치, 단위 변경 등을 포괄적으로 감지.
 */
function hasQuarterlyAnomaly(quarters: QuarterlyData[]): boolean {
  const JUMP_THRESHOLD = 5; // 5배 이상 급변

  for (let i = 0; i < quarters.length - 1; i++) {
    const curr = quarters[i];
    const prev = quarters[i + 1];

    // 매출 급변 체크
    if (curr.revenue != null && prev.revenue != null && prev.revenue > 0) {
      const ratio = curr.revenue / prev.revenue;
      if (ratio > JUMP_THRESHOLD || ratio < 1 / JUMP_THRESHOLD) return true;
    }

    // 순이익 급변 체크 (부호 전환은 허용, 절대값 급변만 감지)
    if (curr.netIncome != null && prev.netIncome != null) {
      const absC = Math.abs(curr.netIncome);
      const absP = Math.abs(prev.netIncome);
      if (absP > 0) {
        const ratio = absC / absP;
        if (ratio > JUMP_THRESHOLD || ratio < 1 / JUMP_THRESHOLD) return true;
      }
    }
  }

  return false;
}
```

이상 감지 시 F등급 + detail에 이유 명시:

```typescript
function makeAnomalyScore(symbol: string): FundamentalScore {
  const anomaly: CriteriaResult = {
    passed: false,
    value: null,
    detail: "데이터 이상 감지: 분기 간 매출/이익 5배 이상 급변",
  };
  return {
    symbol,
    grade: "F",
    totalScore: 0,
    rankScore: 0,
    requiredMet: 0,
    bonusMet: 0,
    criteria: {
      epsGrowth: anomaly,
      revenueGrowth: anomaly,
      epsAcceleration: anomaly,
      marginExpansion: anomaly,
      roe: anomaly,
    },
  };
}
```

### 3. 기존 오염 스코어 정리 — DB 작업

배포 전 비미국 종목의 `fundamental_scores` 레코드 삭제:

```sql
DELETE FROM fundamental_scores
WHERE symbol IN (
  SELECT symbol FROM symbols WHERE country != 'US' AND country IS NOT NULL
);
```

`canSkipScoring` 로직이 기존 오염 스코어를 재사용하는 경로를 차단하기 위해 필수.

---

## 작업 계획

| 단계 | 파일 | 내용 | 완료 기준 |
|------|------|------|----------|
| 1 | `src/agent/fundamental/runFundamentalValidation.ts` | `getAllScoringSymbols` SQL에 country 필터 추가 | diff 확인 |
| 2 | `src/lib/fundamental-scorer.ts` | `hasQuarterlyAnomaly` + `makeAnomalyScore` 추가, `scoreFundamentals` 진입부에 체크 삽입 | diff 확인 |
| 3 | DB | `fundamental_scores` 비US 종목 스코어 삭제 | 삭제 확인 쿼리 |
| 4 | 테스트 | `hasQuarterlyAnomaly` 단위 테스트 + country 필터 동작 검증 | `yarn test` green |

단계 1·2·3은 독립적이므로 병렬 가능. 단계 4는 1·2 완료 후 진행.

---

## 리스크

- **`country IS NULL` 보수 처리**: country 미입력 종목 중 비미국 기업이 포함될 수 있다. 신규 ETL에서 country가 채워지므로 점진 해소. 수용 가능.
- **JUMP_THRESHOLD=5 오탐**: 실제로 5배 이상 성장한 미국 기업(M&A, 극초기 스타트업)이 F등급 처리될 수 있다. 단, 5배는 충분히 관대한 기준이며, 정상적인 SEPA 대상 기업에서 분기 간 5배 급변은 거의 없다.
- **순이익 부호 전환**: 적자→흑자 전환 시 절대값 급변이 발생할 수 있으나, `absP > 0` 조건으로 전분기 0인 경우 스킵하고, 부호 전환 자체는 비율 계산에서 합리적으로 처리된다.
- **TSM 등 비미국 우량주 제외**: 프로젝트 골(미국 시장 주도주)에 부합. 필요 시 후속 화이트리스트 이슈로 대응.
- **`canSkipScoring` 오염 재사용**: 단계 3(DB 정리)을 배포 전 반드시 실행해야 함. 순서 중요.

---

## 후속 이슈 (이번 PR 범위 밖)

- 업종별 지표 적합성 (은행에 EBITDA 부적절, 금융주 ROE 필수 등)
- ETL에서 `reportedCurrency` 필드 저장 → 통화 기반 정밀 필터
- 배당수익률 FMP 분기별 미반영 문제

---

## 의사결정 필요

없음 — 바로 구현 가능.
