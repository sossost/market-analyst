# fix-recommendation-integrity

## 선행 맥락

- PR #180: 사후 검증 시스템 포함한 추천 성과 트래킹 구축
- `fix-tracking-pnl` 피처: PnL 계산 관련 선행 수정 이력 존재
- `onConflictDoNothing`의 target이 `(symbol, recommendation_date)` unique 제약 기반 — 이번 버그의 근본 원인

## 골 정렬

SUPPORT — 데이터 정합성 오류는 추천 성과 트래킹의 신뢰도를 훼손하며, 잘못된 PnL(+465%)이 알파 판단을 왜곡한다. 직접적인 주도주 발굴 기능은 아니지만 시스템 신뢰도 기반이므로 즉시 수정 필요.

## 문제

추천 성과 현황 대시보드에서 4가지 데이터 정합성 버그가 확인됨:
1. **진입가 오류**: LLM이 전달한 entry_price를 그대로 신뢰 → 실제 시장가와 무관한 값 저장 가능
2. **중복 추천**: (symbol, date) unique 제약이지만 날짜가 달라지면 동일 symbol이 재추천됨
3. **보유일 주말 포함**: `daysHeld = daysHeld + 1`을 ETL 실행마다 +1 → 주말은 ETL 미실행이라 실제로 스킵되지만, 메타데이터적으로 거래일 기준임을 명시해야 함 (아래 상세 분석 참조)
4. **프론트엔드 중복 표시**: `fetchActiveRecommendations()`가 symbol별 dedup 없이 전체 ACTIVE 조회

## 버그 분석

### 1. 진입가 오류 (DAWN: $3.77 저장, 실제 $9~10)

`saveRecommendations.ts`는 `entry_price`를 에이전트(LLM)가 도구 호출 시 직접 전달한 값으로 저장한다.

```typescript
const entryPrice = toNum(rec.entry_price);  // LLM이 준 값 그대로
```

LLM은 프롬프트 컨텍스트에서 가져온 가격을 전달하는데, **추천일(recommendation_date)에 해당하는 종가를 stock_phases에서 직접 조회하지 않는다.** LLM이 오래된 가격, 잘못된 가격, 또는 다른 날짜의 가격을 hallucinate할 수 있다.

**근본 원인**: 진입가 검증 없이 LLM 제공 값을 신뢰.

**수정 방향**: `saveRecommendations.ts`에서 INSERT 전에 `daily_prices` 테이블에서 `recommendation_date`의 실제 종가를 조회하여 `entry_price`를 덮어쓴다. LLM 제공값은 fallback으로만 사용.

### 2. 중복 추천 (DAWN ID 11 + ID 13, EONR ID 8 + ID 12)

unique 제약: `(symbol, recommendation_date)` — 날짜가 다르면 동일 symbol이 재저장됨.

```typescript
.onConflictDoNothing({
  target: [recommendations.symbol, recommendations.recommendationDate],
})
```

DAWN이 3/12에 추천된 후 3/13에 다시 추천되면 새로운 row가 생성된다. ACTIVE 상태의 동일 symbol 존재 여부를 체크하는 로직이 없다.

**수정 방향**: INSERT 전에 `WHERE symbol = ? AND status = 'ACTIVE'` 쿼리로 기존 ACTIVE 추천 존재 시 skip.

### 3. 보유일 주말 포함

`update-recommendation-status.ts`의 ETL은 거래일에만 실행된다:

```typescript
const targetDate = await getLatestTradeDate();  // stock_phases + daily_prices가 있는 날만
```

따라서 주말에는 ETL 자체가 실행되지 않아 `daysHeld + 1`도 발생하지 않는다. **실제로 주말은 이미 카운트되지 않는다.**

단, 확실히 하려면 `daysHeld` 계산을 `daily_prices`에 있는 실제 거래일 수 기준으로 명시적으로 계산하도록 변경하면 더 견고하다.

**수정 방향**: 현행 유지(ETL이 거래일만 실행되므로 실질 버그 아님) + 코드 주석으로 의도 명시. 단, 향후 backfill 시나리오를 위해 거래일 카운트 명시적 계산으로 개선.

### 4. 프론트엔드 중복 표시

```typescript
// 현재: status = 'ACTIVE'인 모든 row 반환 → 같은 symbol이 여러 번 포함
.eq('status', 'ACTIVE')
.order('pnl_percent', { ascending: false })
```

DB에 DAWN ID 11, ID 13이 모두 ACTIVE이면 둘 다 반환된다.

**수정 방향**: 쿼리 레벨에서 `symbol`별 최신 row(recommendation_date DESC)만 선택하도록 변경. 또는 `fetchActiveRecommendations()`에서 symbol dedup 처리.

## Before → After

**Before**:
- DAWN entry_price = $3.77 (LLM hallucination) → PnL +465% (왜곡)
- 같은 symbol이 날짜별로 중복 추천되어 DB와 UI에 복수 row 존재
- 프론트에서 같은 symbol이 여러 번 렌더링됨
- daysHeld 계산 의도가 코드에서 불명확

**After**:
- entry_price = 추천일의 실제 종가(daily_prices 기준) → PnL 신뢰 가능
- ACTIVE 상태의 symbol은 재추천 불가 → 중복 row 생성 차단
- 프론트에서 symbol당 최신 추천 1건만 표시
- daysHeld 계산 로직에 의도 주석 명시

## 변경 사항

### A. `src/agent/tools/saveRecommendations.ts`

1. **진입가 검증**: 각 symbol에 대해 `daily_prices` 테이블에서 `recommendation_date`의 종가 조회. 조회 성공 시 LLM 제공값 대신 실제 종가 사용. 조회 실패 시 LLM 제공값 fallback + 경고 로그.
2. **중복 추천 방지**: INSERT 전에 `WHERE symbol = ? AND status = 'ACTIVE'` 쿼리 실행. ACTIVE row 존재 시 skip (skippedCount++ + 경고 로그).

### B. `src/etl/jobs/update-recommendation-status.ts`

1. **daysHeld 주석**: `daysHeld + 1`이 거래일 기준임을 명시하는 주석 추가. ETL이 `getLatestTradeDate()`로 거래일만 실행되므로 주말/공휴일은 자동 제외됨을 문서화.

### C. `frontend/src/features/dashboard/lib/supabase-queries.ts`

1. **fetchActiveRecommendations() dedup**: symbol별 최신 recommendation_date 기준으로 중복 제거. Supabase 클라이언트 쿼리에서 직접 처리하거나 JS 레벨에서 Map dedup.

## 작업 계획

### Step 1: 진입가 검증 + 중복 추천 방지 (saveRecommendations.ts)
- **에이전트**: 실행팀 구현
- **완료 기준**:
  - `daily_prices`에서 recommendation_date 종가 조회 후 entry_price 덮어쓰기
  - 조회 실패 시 LLM 값 fallback + `logger.warn` 출력
  - ACTIVE 중복 체크 로직 추가, 중복 시 skip + warn 로그
  - 기존 테스트 통과

### Step 2: daysHeld 주석 명시 (update-recommendation-status.ts)
- **에이전트**: 실행팀 구현
- **완료 기준**:
  - `daysHeld + 1` 라인에 "거래일 기준: ETL이 getLatestTradeDate() 기반으로 거래일에만 실행" 주석 추가

### Step 3: 프론트엔드 dedup (supabase-queries.ts)
- **에이전트**: 실행팀 구현
- **완료 기준**:
  - `fetchActiveRecommendations()` 반환값에서 symbol 중복 제거
  - symbol별 pnl_percent가 가장 높은 row(또는 recommendation_date가 최신인 row) 1건만 반환
  - 기존 타입 인터페이스 변경 없음

### Step 4: 코드 리뷰 + PR
- **에이전트**: code-reviewer → pr-manager
- **완료 기준**: CRITICAL/HIGH 이슈 없음, PR 생성 완료

## 리스크

- **기존 오염 데이터**: DAWN ID 11($3.77)은 이미 DB에 존재. 이번 수정은 신규 추천부터 적용. 기존 잘못된 row는 별도 수동 정정 또는 backfill 스크립트 필요 (이번 스코프 외).
- **entry_price fallback**: daily_prices에 해당 날짜 종가가 없는 경우(신규 상장, 거래 정지 등) LLM 값으로 fallback — 이 경우 `logger.warn`으로 추적 가능하게 해야 함.
- **프론트 dedup 기준**: symbol별 "최신 날짜" vs "최고 PnL" 중 어느 기준으로 dedup할지 — 최신 날짜(recommendation_date DESC) 기준이 직관적이므로 채택.

## 의사결정 필요

- **기존 오염 데이터(DAWN $3.77 등) 정정 여부**: 이번 스코프에 포함할지, 별도 DB 수동 수정으로 처리할지. 자율 판단: 별도 처리(수동 UPDATE SQL)로 분리 권고 — 구현 로직과 혼재하면 복잡도 증가.
- **Step 2 daysHeld 거래일 카운트 명시적 계산 도입 여부**: 주석만 달지, 아예 `recommendation_date`부터 `targetDate`까지의 daily_prices 거래일 수를 COUNT하여 재계산할지. 자율 판단: 주석만 달기 채택 — 현행 로직이 실질적으로 올바르고, 명시적 재계산은 N+1 쿼리 유발.
