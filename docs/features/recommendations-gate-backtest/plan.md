# recommendations 게이트 정량 백테스트

## 선행 맥락

`backtest-signals.ts`가 선행 기술적 백테스트 아키텍처를 확립했다. 이 스크립트를 직접 참고한다:
- DB에서 시그널 수집 → forward return 계산 → 파라미터 조합별 집계 → JSON 저장
- pool.query 직접 사용 (Drizzle ORM 아님) — 스크립트 컨벤션 동일하게 유지
- 배치 처리: `calculateReturns`의 배치 패턴 (BATCH = 100) 재사용 가능
- SPY 벤치마크 로직 그대로 재사용

추가 맥락:
- `validate-phase1-late.ts`의 `batchGetFuturePhases` 패턴 — 종목×날짜 조합의 배치 조회 패턴이 이 백테스트에도 핵심.
- 현재 게이트들은 모두 반응적으로 추가됨 (Phase Exit 6건 → 지속성/안정성 강화 #366, #436 / SEPA F 차단 #449). 체계적 검증은 없었음.

무효 판정 체크:
- forward return 계산은 DB 과거 가격 기반 — LLM 개입 없음. 백테스트 오염 없음.

## 골 정렬

ALIGNED. 게이트의 실질 효과를 정량화하면:
1. 불필요한 게이트 제거 → 더 많은 Phase 2 초입 종목을 놓치지 않음 (포착 속도 향상)
2. 효과 있는 게이트 근거 확보 → #547 ETL 자동화 게이트 확정의 데이터 근거
3. 최적 게이트 조합 제안 → 알파 품질 유지하면서 후보 풀 개선

## 문제

recommendations 게이트 11개 조건이 모두 특정 실패 사례에 반응적으로 추가됐으나, 각 조건이 실제로 얼마나 나쁜 진입을 차단하고 좋은 진입을 보존하는지 정량 검증된 적 없다. "#547 ETL 자동화 게이트 확정" 전에 근거를 확보해야 한다.

## Before → After

**Before**: 게이트 11개가 직관과 사례 기반으로 설정. 어떤 조건이 실질 기여하는지 불명.

**After**: 조건별 기여도 수치화. 각 게이트의 "제거하면 어떻게 되는가" 데이터 확보. #547 게이트 설계의 정량 근거.

## 변경 사항

신규 스크립트 1개 생성:
- `scripts/backtest-gates.ts`

기존 코드 변경 없음.

---

## 백테스트 설계

### 핵심 판단: "게이트 기여도" 측정 방식

게이트 기여도를 측정하는 올바른 방법은 **ablation** — 각 게이트를 하나씩 제거했을 때 성과 지표 변화를 본다.

잘못된 방법: "게이트가 차단한 종목의 실제 성과"를 직접 측정하는 것. 차단 종목의 forward return을 알려면 해당 종목이 recommendations에 있어야 하는데, 이미 차단됐다. 이 데이터는 stock_phases + daily_prices에 있으므로 계산 가능하지만 해석 주의 필요.

채택 방법: **ablation study**
- 기준선(베이스라인): 게이트 전부 적용한 경우 vs 아무 게이트 없는 경우
- 조건별 ablation: 게이트 하나씩 제거 → 기준선 대비 성과 변화 측정
- 결과 해석: 제거 시 성과가 나빠지면 → 해당 게이트 유효 / 변화 없으면 → 불필요 가능성

### 데이터 소스

| 데이터 | 테이블 | 비고 |
|--------|--------|------|
| Phase 정보 | `stock_phases` | phase, rs_score, prev_phase, date |
| 가격 | `daily_prices` | close, symbol, date |
| 펀더멘탈 | `fundamental_scores` | grade, scored_date |
| 시장 레짐 | `market_regimes` | regime, date |
| 섹터 RS | `sector_rs_daily` | group_phase, avg_rs |
| 종목 메타 | `symbols` | sector, industry |
| 벤치마크 | `daily_prices` WHERE symbol = 'SPY' | |

### 시그널 정의

"게이트 통과 후보"의 기준점: **Phase 2 + prev_phase != 2 (진입일)**

```sql
-- 기준 시그널: Phase 2 진입일 (prev_phase가 2가 아닌 첫날)
SELECT sp.symbol, sp.date AS entry_date, sp.rs_score, sp.phase,
       sp.prev_phase, dp.close AS entry_price,
       s.sector, s.industry,
       mr.regime AS market_regime,
       srd.group_phase AS sector_group_phase,
       srd.avg_rs AS sector_rs
FROM stock_phases sp
JOIN daily_prices dp ON dp.symbol = sp.symbol AND dp.date = sp.date
LEFT JOIN symbols s ON s.symbol = sp.symbol
LEFT JOIN market_regimes mr ON mr.date = sp.date
LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
WHERE sp.phase = 2
  AND sp.prev_phase IS DISTINCT FROM 2
  AND dp.close IS NOT NULL
  AND sp.date >= '2025-09-25'
  AND sp.date <= '2026-01-01'  -- 90일 forward return 확보 가능한 컷오프
ORDER BY sp.date ASC
```

**중요한 설계 결정**: 컷오프 날짜를 `현재일 - 90일`로 설정한다. 90일 forward return을 실제로 측정할 수 없는 최근 종목을 포함하면 결과가 왜곡된다. (`validate-phase1-late.ts`의 `cutoffDate` 패턴과 동일.)

### 게이트 조건 재현 방법 (ablation용)

각 게이트를 스크립트 내에서 재현할 때 필요한 데이터:

| 게이트 | 재현 방법 | 데이터 소스 |
|--------|-----------|------------|
| RS 하한 (< 60) | `sp.rs_score < 60` | stock_phases |
| RS 상한 (> 95) | `sp.rs_score > 95` | stock_phases |
| 저가주 (< $5) | `dp.close < 5` | daily_prices |
| Bear 레짐 | `mr.regime IN ('EARLY_BEAR', 'BEAR')` | market_regimes |
| Phase 2 지속성 (< 3일/5일) | 진입일 기준 과거 5캘린더일 내 phase=2 카운트 | stock_phases |
| Phase 2 안정성 (3연속) | 진입일 포함 직전 3거래일 phase=2 여부 | stock_phases |
| SEPA F 차단 | `fundamental_scores.grade = 'F'` | fundamental_scores |

**쿨다운(7일)은 ablation 대상에서 제외**: 쿨다운은 동일 종목 재진입을 막는 운영 규칙이지, 진입 품질을 측정하는 게이트가 아니다. forward return 측정 맥락에서 의미 없다.

**레짐 게이트 주의**: 6개월 기간(2025-09 ~ 2026-03)에 EARLY_BEAR/BEAR 레짐 구간이 얼마나 존재했는지 먼저 확인. 구간이 짧으면 레짐 게이트 ablation 결과의 신뢰도가 낮다는 점을 결과에 명시.

### Forward Return 측정

**기준**: 진입가(entry_price) 대비 N거래일 후 종가

```
return_Nd = (close_at_Nd - entry_price) / entry_price * 100
```

- 측정 기간: 30거래일, 60거래일, 90거래일
  - backtest-signals.ts는 캘린더일이 아닌 거래일 기준으로 row_num 사용 — 동일 방식
- Phase 유지율: 30/60/90일 각 시점에 phase=2인 비율
  - Phase 유지율은 수익률과 별개 지표. 포지션 품질을 보는 추가 렌즈.
- SPY 벤치마크: 동일 시그널 날짜에 SPY 매수 → N일 후 수익률 평균 (backtest-signals.ts 패턴 재사용)

**null 처리**: 진입일로부터 N거래일이 현재까지 도달하지 않은 경우 → null. 집계 시 null 제외. count를 명시적으로 출력해서 신뢰도 표기.

**컷오프 강제**: 90일 forward가 확보 안 된 최근 진입은 분석 대상에서 제외. 30일 분석만 할 경우 더 최근 데이터 포함 가능하지만, 3개 기간을 통일하기 위해 90일 컷오프로 단일화.

### 집계 지표

각 게이트 조건별 ablation 결과:

```
{
  gateName: string,            // 게이트 이름
  withGate: {                  // 게이트 적용 (해당 게이트만 제거, 나머지는 적용)
    n: number,
    return30d: { avg, median, winRate },
    return60d: { avg, median, winRate },
    return90d: { avg, median, winRate },
    phase2RetentionAt30d: number,  // 30일 시점 phase=2 비율
    phase2RetentionAt60d: number,
    phase2RetentionAt90d: number,
    spyAlpha30d: number,       // return30d.avg - spy30d.avg
    spyAlpha60d: number,
    spyAlpha90d: number,
  },
  withoutGate: { /* 동일 구조 */ },
  gateContribution: {
    // withGate - withoutGate 차이
    deltaReturn30d: number,
    deltaReturn60d: number,
    deltaReturn90d: number,
    deltaWinRate60d: number,
    filteredCount: number,     // 이 게이트가 차단한 시그널 수
    filteredRatio: number,     // 전체 대비 비율
  }
}
```

### 성과 기준 (효과 있는 게이트 판단 기준)

게이트가 "유효하다"의 정량 기준을 명시한다. 이 기준이 없으면 결과 해석이 주관적이 된다:

- **평균 수익률 개선**: withGate.return60d.avg > withoutGate.return60d.avg + 0.5pp
- **승률 개선**: withGate.return60d.winRate > withoutGate.return60d.winRate + 2pp
- **또는 차단 종목이 유의미한 불량 종목**: withoutGate 추가분 평균 수익률 < -2% (명백한 나쁜 진입 차단)

단, 샘플 수가 적은 게이트(차단 < 20건)는 통계적 유의성 경고를 함께 출력.

## 작업 계획

### Phase 1: 데이터 파악 (스크립트 초반부)

**목적**: 실제로 분석 가능한 데이터 범위와 각 게이트의 현재 차단율을 먼저 출력한다.

```
=== 데이터 파악 ===
기간: 2025-09-25 ~ 2026-01-01 (90일 컷오프 적용)
Phase 2 진입 시그널 총 N건

레짐 분포:
  BULL: X건 (Y%)
  EARLY_BULL: ...
  LATE_BULL: ...
  EARLY_BEAR: ...
  BEAR: ...

게이트별 현재 차단율 (단순 카운트):
  RS < 60: N건 (Y%)
  RS > 95: N건 (Y%)
  저가주 < $5: N건 (Y%)
  Bear 레짐: N건 (Y%)
  지속성 미충족: N건 (Y%)
  안정성 미충족: N건 (Y%)
  SEPA F: N건 (Y%)
```

이 단계에서 "레짐 게이트 차단 종목이 10건 미만"이면 해당 게이트의 ablation 결과에 자동으로 경고 태그 추가.

**에이전트**: 구현팀

### Phase 2: Forward Return 계산 엔진

`backtest-signals.ts`의 `calculateSingleReturn` 패턴을 그대로 차용:
- `daily_prices`에서 진입일 이후 N거래일 종가를 row_num으로 슬라이스
- 60/90거래일 기준이라 시그널당 최대 90행 조회
- 시그널 수 × 90행 = DB 부담이 크므로 배치 처리 필수

배치 전략:
1. 1단계: 분석 대상 전체 symbols + date 범위로 `daily_prices` 한 번에 로드 → 메모리 맵 구축
2. 2단계: 메모리 맵에서 각 시그널의 forward return 계산 (DB 왕복 없음)

`batchGetFuturePhases`에서 배운 패턴: 종목별 루프에서 개별 쿼리 날리지 말고, 전체를 한 번에 가져와서 인메모리에서 슬라이스.

Phase 유지율: 동일하게 `stock_phases`도 한 번에 로드 → 인메모리 맵.

**에이전트**: 구현팀

### Phase 3: Ablation 집계

각 게이트별로:
1. 전체 시그널에서 해당 게이트 적용 기준으로 분할 (통과 vs 차단)
2. 통과 집합과 전체 집합의 forward return 비교
3. 차단 집합의 forward return (이게 "게이트가 막은 종목의 실제 성과")

ablation 순서:
1. 베이스라인: 게이트 없음 (전체 Phase 2 진입)
2. 조건별 단독 적용 (7개 게이트 각각)
3. 현재 전체 게이트 적용 (기준점)

**에이전트**: 구현팀

### Phase 4: 출력 및 저장

콘솔 출력 포맷:
```
=== 게이트 Ablation 결과 ===

기준선 (게이트 없음)
  N=XXX | 30d: avg/median/winRate | 60d: ... | 90d: ...
  SPY 대비 알파 (60d): +X.X%

현재 전체 게이트 적용
  N=XXX | 30d: ... | 60d: ... | 90d: ...
  SPY 대비 알파 (60d): +X.X%
  게이트 차단율: XX% (전체 대비 통과 YY%)

개별 게이트 기여도
┌─────────────────────┬──────┬──────┬────────┬────────┬────────┬──────────┐
│ 게이트               │ 차단N │ 차단% │ 60d평균 │ 60d승률 │ 제거시Δ60d │ 판정    │
├─────────────────────┼──────┼──────┼────────┼────────┼────────┼──────────┤
│ RS < 60              │  XXX │  XX% │  X.X%  │  XX%   │  -X.X% │ 유효     │
│ RS > 95              │  XXX │  XX% │  X.X%  │  XX%   │  +X.X% │ 검토필요  │
│ 저가주 < $5          │  XXX │  XX% │  X.X%  │  XX%   │  -X.X% │ 유효     │
│ Bear 레짐 (!경고:N<20)│  XXX │  XX% │  X.X%  │  XX%   │  X.X%  │ 판단불가 │
│ 지속성 3일            │  XXX │  XX% │  X.X%  │  XX%   │  -X.X% │ 유효     │
│ 안정성 3연속           │  XXX │  XX% │  X.X%  │  XX%   │  -X.X% │ 유효     │
│ SEPA F 차단           │  XXX │  XX% │  X.X%  │  XX%   │  -X.X% │ 유효     │
└─────────────────────┴──────┴──────┴────────┴────────┴────────┴──────────┘

검토 필요 게이트: RS > 95
  → 제거 시 성과가 오히려 개선됨. 과열 차단이 좋은 종목도 막고 있을 가능성.
  → 권고: 임계값 조정 검토 (예: 97 또는 제거)
```

저장: `data/backtest/gate-backtest-{date}.json`

**에이전트**: 구현팀

## 완료 기준

- [ ] `npx tsx scripts/backtest-gates.ts` 실행 시 오류 없이 완료
- [ ] 기간 내 Phase 2 진입 시그널 전체 처리 (0건이면 오류)
- [ ] 7개 게이트 각각의 ablation 결과 출력
- [ ] 각 게이트에 "유효 / 검토필요 / 판단불가(샘플부족)" 판정 자동 표시
- [ ] SPY 알파 대비 수치 포함
- [ ] JSON 결과 파일 저장

## 리스크

### 1. Bear 레짐 게이트 샘플 부족 가능성
6개월 기간 중 EARLY_BEAR/BEAR 구간이 짧을 수 있다. 백테스트 기간이 2025-09~2026-01 사이인데, 이 구간의 실제 레짐 분포를 모른다. 차단 종목이 20건 미만이면 "판단불가" 표시 자동화. CEO가 레짐 게이트 판단을 원하면 별도 구간 연장 검토.

### 2. Forward Return = 수익률이 아닌 Phase 포착 성과 측정
이 백테스트는 "수익률"을 측정하지만, 프로젝트 골은 "Phase 2 초입 포착"이다. Phase 2를 오래 유지하는 종목이 수익률도 좋을 가능성이 높지만, 수익률 좋은 종목이 반드시 Phase 2 초입은 아닐 수 있다. Phase 유지율을 수익률과 병행 측정하는 이유.

### 3. 과거 게이트 조건 재현 한계
현재 게이트 일부(Bear 예외, Late Bull 감쇠)는 재현이 복잡하다. 이번 백테스트에서는 단순화: Bear 레짐 = EARLY_BEAR/BEAR 구간 전면 차단. Bear 예외/Late Bull 감쇠는 ablation 대상에서 제외 (별도 복잡도).

### 4. DB 쿼리 부하
Phase 2 진입 시그널이 수천 건이라면 daily_prices 로드가 커질 수 있다. 전체 로드 전략으로 N+1 방지. 메모리 과다 시 기간 분할 처리 옵션 추가 (--from/--to 인자).

## 의사결정 필요

없음 — 바로 구현 가능.

단, 백테스트 결과 수령 후 CEO가 판단해야 할 것:
- "검토필요" 판정 게이트를 실제로 제거/조정할지
- 결과를 #547 ETL 자동화에 어떻게 반영할지
