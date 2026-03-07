# 초입 포착 도구 유효성 정량 검증 (GitHub #58)

## 선행 맥락

### recursive-improvement-reliability spec (2026-03-07)
- 재귀 개선 루프의 핵심 문제: "같은 LLM이 생성+검증하는 루프" — 자기확증편향
- 이번 미션은 그 대응책: LLM 없이 순수 DB 데이터로 도구 유효성을 검증하는 것
- 이미 "LLM 백테스트 금지" 원칙 수립됨 — 이번 검증은 SQL/스크립트 기반으로 수행

### MEMORY.md 핵심 괴리 (2026-03-07)
- 목표: Phase 1→2 전환 초입을 남들보다 먼저 포착
- 현실: 이미 Phase 2 진행 중(RS 90+, 52주고가 근처) 종목만 리포트
- 원인: 초입 포착 도구(getPhase1LateStocks, getRisingRS, getFundamentalAcceleration) 실전 검증 미수행

### CEO 긴급 발견 (2026-03-07)
- LCNB, COO: Phase 3→1 전환(천장 붕괴) 종목이 "Phase 2 진입 대기"로 리포트됨
- 원인 코드 위치 특정: `getPhase1LateStocks.ts:71` — WHERE 절 prev_phase 조건 없음
- `phase-detection.ts:93-98` — Phase 1 판정 기준이 Phase 3→1 전환을 걸러내지 못함

## 골 정렬

**ALIGNED** — 초입 포착 도구가 실제로 Phase 2 전환을 선행 포착하는지 정량 검증하는 것은 프로젝트 골의 직접 검증이다. 도구가 작동하지 않으면 알파 형성 자체가 불가능하다.

### 무효 판정 체크
- LLM 백테스트? **아님** — 순수 SQL/스크립트 기반 사후 성과 집계
- 같은 LLM이 생성+검증? **아님** — 도구 출력 vs DB 실제 Phase 전환 비교
- 이미 실패한 접근의 반복? **아님** — 최초 정량 검증 시도

## 문제

초입 포착 도구 3종이 실전에서 오작동하는 것이 확인됐다:
1. `getPhase1LateStocks`: Phase 3→1 하락 전환(false positive)과 Phase 4→1 진짜 바닥 탈출을 구분하지 못함
2. `getRisingRS`, `getFundamentalAcceleration`: 포착 후 실제로 Phase 2 진입하는지 검증된 적 없음

도구의 유효성을 정량 데이터로 확인하지 않으면, 시스템이 false positive를 계속 리포트하고 CEO가 이를 신뢰하여 잘못된 판단을 내릴 수 있다.

## Before → After

### Before (현재)

| 도구 | 문제 |
|------|------|
| `getPhase1LateStocks` | WHERE에 prev_phase 없음 → Phase 3→1 하락 전환 종목도 반환 |
| `phase-detection.ts` | Phase 1 판정: MA150 ±2% + 가격 ±5%만 확인 → 하락 중 일시 조건 충족 가능 |
| `getRisingRS` | 포착 후 RS 추이 및 주가 성과 검증 안 됨 |
| `getFundamentalAcceleration` | 포착 후 Phase 2 전환율 검증 안 됨 |
| 검증 구조 | 검증 결과 저장 없음 → QA 활용 불가 |

### After (목표)

| 항목 | 목표 상태 |
|------|----------|
| `getPhase1LateStocks` | prev_phase IN (3, 4) 조건 추가 → 하락 전환 false positive 차단 |
| `phase-detection.ts` | Phase 1 판정에 MA150 slope 하한선 추가 고려 (검증 결과 기반 판단) |
| 검증 스크립트 3종 | SQL 기반 사후 성과 집계 → 각 도구의 전환율/RS 변화/수익률 정량화 |
| 검증 결과 저장 | `data/review-feedback/tool-validation-{date}.json` 구조화 저장 |
| threshold 유효성 | 현재 기준값(RS 20+, vol_ratio 1.2+, RS 30~60)이 최적인지 데이터 기반 확인 |

## 변경 사항

### 1. 긴급 버그 수정: `getPhase1LateStocks.ts`

**문제**: WHERE 절에 prev_phase 조건 없음 — Phase 3→1 전환 종목(하락 중) 포함

**수정**:
```sql
-- Before (line 71 근처)
WHERE sp.date = $1
  AND sp.phase = 1
  AND sp.ma150_slope::numeric > -0.001
  AND sp.rs_score >= 20
  AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.2

-- After
WHERE sp.date = $1
  AND sp.phase = 1
  AND sp.prev_phase IN (3, 4)   -- Phase 3→1 하락 전환 차단. NULL은 새 종목이므로 보수적으로 제외
  AND sp.ma150_slope::numeric > -0.001
  AND sp.rs_score >= 20
  AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.2
```

**Phase 전환 의미 정리**:
- `prev_phase = 3` → 현재 1: Phase 3(분산/천장)에서 1로 → 하락 전환 초기. **false positive.**
- `prev_phase = 4` → 현재 1: Phase 4(하락)에서 1로 → 진짜 바닥 탈출 가능성. **false positive.**
- `prev_phase = 1` → 현재 1: 기존 Phase 1 유지 — **유효한 base 형성 중.**
- `prev_phase = 2` → 현재 1: Phase 2(상승) 이후 조정으로 1 복귀 — **고점 조정. 보수적으로 제외.**

따라서 `prev_phase = 1`만 허용하거나, `prev_phase IN (1)` 단일 조건이 가장 엄격하다.
검증 결과에 따라 최종 결정.

**의사결정 필요**: prev_phase = 1만 허용(엄격) vs prev_phase IS NOT IN (3, 4)(완화) — 검증 전에는 판단 불가. **기획서 확정 시 CEO 판단 요청.**

### 2. 검증 스크립트 3종 (순수 DB 쿼리, LLM 없음)

#### 2-A: `scripts/validate-phase1-late.ts`

목적: `getPhase1LateStocks` 조건에 부합했던 종목들이 이후 N일 내 Phase 2로 전환한 비율

핵심 쿼리 구조:
```sql
-- 과거 특정 기간 동안 Phase 1 후기 조건을 충족한 종목 집합을 구성
-- 기간 예시: 최근 6개월 (데이터 존재 기간에 맞게 조정)
WITH phase1_late_candidates AS (
  SELECT symbol, date AS signal_date
  FROM stock_phases
  WHERE phase = 1
    AND prev_phase = 1          -- 현재 버그 수정 후 조건
    AND ma150_slope::numeric > -0.001
    AND rs_score >= 20
    AND COALESCE(vol_ratio::numeric, 0) >= 1.2
    AND date BETWEEN '2025-06-01' AND '2025-12-31'  -- 검증 기간 파라미터화
),
-- signal_date로부터 20/40/60 거래일 후 phase 확인
follow_up AS (
  SELECT
    c.symbol,
    c.signal_date,
    sp20.phase AS phase_20d,
    sp40.phase AS phase_40d,
    sp60.phase AS phase_60d
  FROM phase1_late_candidates c
  LEFT JOIN LATERAL (
    SELECT phase FROM stock_phases
    WHERE symbol = c.symbol AND date > c.signal_date
    ORDER BY date LIMIT 1 OFFSET 19
  ) sp20 ON true
  -- (sp40, sp60 유사)
)
SELECT
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE phase_20d = 2) AS phase2_within_20d,
  COUNT(*) FILTER (WHERE phase_40d = 2) AS phase2_within_40d,
  COUNT(*) FILTER (WHERE phase_60d = 2) AS phase2_within_60d,
  ROUND(100.0 * COUNT(*) FILTER (WHERE phase_20d = 2) / NULLIF(COUNT(*), 0), 1) AS conversion_rate_20d_pct
FROM follow_up
```

출력 지표:
- 총 시그널 수
- 20d/40d/60d 이내 Phase 2 전환율 (%)
- prev_phase 별 전환율 분리 (버그 수정 전후 효과 비교)
- false positive 비율: 시그널 후 Phase 4로 하락한 비율

#### 2-B: `scripts/validate-rising-rs.ts`

목적: RS 30~60 상승 종목의 4주/8주/12주 후 RS 변화 및 Phase 전환 여부

핵심 쿼리 구조:
```sql
WITH rising_rs_signals AS (
  SELECT sp.symbol, sp.date AS signal_date, sp.rs_score AS rs_at_signal
  FROM stock_phases sp
  LEFT JOIN stock_phases sp_4w ON
    sp_4w.symbol = sp.symbol AND
    sp_4w.date = (SELECT MAX(date) FROM stock_phases WHERE date <= (sp.date::date - INTERVAL '28 days')::text)
  WHERE sp.date BETWEEN '2025-06-01' AND '2025-12-31'
    AND sp.rs_score BETWEEN 30 AND 60
    AND (sp.rs_score - COALESCE(sp_4w.rs_score, sp.rs_score)) > 0
)
SELECT
  AVG(rs_4w_later - rs_at_signal) AS avg_rs_change_4w,
  AVG(rs_8w_later - rs_at_signal) AS avg_rs_change_8w,
  AVG(rs_12w_later - rs_at_signal) AS avg_rs_change_12w,
  COUNT(*) FILTER (WHERE rs_12w_later > 70) AS reached_rs_70_count,
  COUNT(*) FILTER (WHERE phase_12w_later = 2) AS phase2_within_12w
FROM ...
```

출력 지표:
- 시그널 후 평균 RS 변화 (4w/8w/12w)
- RS 70+ 도달 비율 (성공 기준)
- Phase 2 전환 비율
- 섹터 RS 상승 여부에 따른 성과 분리 (섹터 동반 상승의 효과 검증)

#### 2-C: `scripts/validate-fundamental-accel.ts`

목적: EPS/매출 가속 포착 후 6개월/12개월 Phase 및 RS 변화

핵심 쿼리 구조:
```sql
-- quarterly_financials에서 가속 패턴 종목 식별 (코드와 동일한 로직)
-- 포착 시점의 Phase/RS 기록
-- 포착 후 6개월/12개월 stock_phases 조회
```

출력 지표:
- 포착 후 Phase 분포 (Phase 1/2/3/4 비율)
- 평균 RS 변화
- 펀더멘탈 가속 + Phase 1 동시 조건 종목의 성과 (교집합 효과)

### 3. 검증 결과 저장 구조

저장 경로: `data/review-feedback/tool-validation-{YYYY-MM-DD}.json`

```typescript
interface ToolValidationResult {
  generatedAt: string;
  validationPeriod: { from: string; to: string };
  tools: {
    phase1Late: {
      totalSignals: number;
      conversionRate20d: number;   // Phase 2 전환율 (%)
      conversionRate40d: number;
      conversionRate60d: number;
      falsePositiveRate: number;   // 시그널 후 Phase 4 하락 비율
      byPrevPhase: Record<number, { count: number; conversionRate: number }>;
      thresholdAnalysis: {
        ma150SlopeThreshold: number;   // 현재: -0.001
        rsMinThreshold: number;         // 현재: 20
        volRatioThreshold: number;      // 현재: 1.2
      };
    };
    risingRS: {
      totalSignals: number;
      avgRsChange4w: number;
      avgRsChange8w: number;
      avgRsChange12w: number;
      reachedRs70Rate: number;
      phase2ConversionRate: number;
      sectorAlignedBoost: number;  // 섹터 RS 상승 동반 시 성과 차이
    };
    fundamentalAccel: {
      totalSignals: number;
      phase2Rate6m: number;
      phase2Rate12m: number;
      avgRsChange6m: number;
      combinedWithPhase1Rate: number;  // 펀더멘탈 + Phase 1 교집합 성과
    };
  };
  conclusions: {
    phase1LateIsEffective: boolean;
    risingRsIsEffective: boolean;
    fundamentalAccelIsEffective: boolean;
    recommendedThresholdChanges: string[];
  };
}
```

## 작업 계획

### Phase 1: 긴급 버그 수정 (선행 필수)

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 1-1 | `getPhase1LateStocks.ts` prev_phase 필터 추가 | 실행팀 | SQL 수정 + 단위 테스트 추가 (Phase 3→1, Phase 4→1 false positive 제거 확인) | - |
| 1-2 | `phase-detection.ts` Phase 1 판정 기준 검토 | 실행팀 | 코드 분석 후 추가 수정 필요 여부 판단 — 검증 결과 보고 후 결정 | 1-1과 병렬 |

**테스트 케이스**:
- Phase 3 → Phase 1 전환 종목: 필터에서 제외됨을 확인
- Phase 4 → Phase 1 전환 종목: 필터에서 제외됨을 확인
- Phase 1 → Phase 1 유지 종목: 올바르게 포함됨을 확인
- prev_phase = NULL (신규 종목): 제외됨을 확인 (보수적 처리)

### Phase 2: 검증 스크립트 작성 (병렬 실행 가능)

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 2-A | `scripts/validate-phase1-late.ts` | 실행팀 | 스크립트 실행 → JSON 결과 출력, 전환율 계산 정확성 확인 | Phase 1 완료 후 |
| 2-B | `scripts/validate-rising-rs.ts` | 실행팀 | 스크립트 실행 → JSON 결과 출력, RS 변화 집계 정확성 확인 | 2-A와 병렬 |
| 2-C | `scripts/validate-fundamental-accel.ts` | 실행팀 | 스크립트 실행 → JSON 결과 출력 | 2-A와 병렬 |

### Phase 3: 결과 해석 + threshold 조정 판단

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 3-1 | 검증 결과 CEO 보고 + threshold 조정 여부 판단 | 매니저 | 데이터 기반 권고사항 정리, CEO 승인 후 조정 작업 착수 | - |
| 3-2 | threshold 조정 (CEO 승인 후) | 실행팀 | 조정된 기준값으로 재검증 스크립트 실행 확인 | 3-1 후 |

### Phase 4: QA 통합

| # | 작업 | 에이전트 | 완료 기준 | 병렬 |
|---|------|---------|----------|------|
| 4-1 | 코드 리뷰 (버그 수정 + 스크립트 전체) | 검증팀 (code-reviewer) | CRITICAL/HIGH 이슈 없음 | - |
| 4-2 | PR 생성 | pr-manager | PR #58 연결, 검증 결과 첨부 | 4-1 후 |

## 리스크

1. **데이터 기간 부족**: `stock_phases` 테이블에 최소 6개월~1년치 데이터가 있어야 의미 있는 전환율 계산 가능. 데이터 시작일 확인 필요. 데이터가 부족하면 검증 기간을 짧게 설정하되 샘플 수 한계를 명시해야 함.

2. **샘플 편향**: 현재 DB에 있는 종목 유니버스가 이미 필터된 종목들일 수 있음 (survivorship bias). 검증 결과 해석 시 이 점을 보수적으로 명시해야 함.

3. **Phase 1 판정 임계값 변경의 파급 효과**: `phase-detection.ts` 수정은 ETL 전체 재실행이 필요할 수 있음. 버그 수정(getPhase1LateStocks)과 Phase 판정 로직 변경을 분리해서 접근해야 함.

4. **prev_phase 조건 강도**: `prev_phase = 1`만 허용(엄격)하면 신호 수가 급감할 수 있음. 검증 전 단계에서 조건별 시그널 수를 먼저 카운트하여 실용적인 기준을 설정해야 함.

## 의사결정 필요

1. **prev_phase 허용 범위** (Phase 1 완료 전 CEO 판단 필요):
   - 옵션 A: `prev_phase = 1`만 허용 (엄격) — false positive 최소화, 시그널 수 감소
   - 옵션 B: `prev_phase NOT IN (3, 4)` — Phase 2→1 조정 복귀도 허용, 시그널 수 유지
   - **내 판단**: 긴급 버그 수정이므로 옵션 A로 시작. 검증 결과에서 시그널 수가 너무 적으면 옵션 B로 완화.

2. **검증 기간 설정**:
   - 검증 의미를 위해 최소 3개월 사후 데이터 필요 (시그널 후 60 거래일)
   - DB의 실제 데이터 기간에 따라 자동 설정되도록 스크립트 작성 권고

3. **threshold 조정 기준**:
   - Phase 2 전환율이 몇 % 이하이면 도구를 무효로 판단할 것인가?
   - **내 판단**: 전환율 15% 미만 = 무효 (랜덤보다 낫지 않음), 15~30% = 부분 유효, 30%+ = 유효
   - CEO 승인 필요
