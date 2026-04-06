# 일간 리포트 Phase 전환 종목 수 표시

## 골 정렬

ALIGNED — "Phase 2 초입 포착"이 프로젝트의 절대 골이다. 오늘 Phase 2로 신규 진입한 종목 수는 그 골에 가장 직접적인 데이터임에도 리포트 어디에도 없다. 이 피처는 골과 직접 연결된다.

## 문제

일간 리포트에 Phase 2 비율(%)은 있지만, **오늘 새로 Phase 2로 진입한 종목 수**가 없다. 비율이 30%로 보합이더라도 신규 진입 40건 vs 이탈 40건의 상황과 순이동 없는 보합은 전혀 다른 시장이다. 진입/이탈 흐름을 보여야 Phase 2 초입 모멘텀을 제대로 진단할 수 있다.

## Before → After

**Before**: Phase 분포 섹션 = 비율(%) + 분포 바 + A/D Ratio + 신고가/신저가
**After**: Phase 분포 섹션에 "Phase 2 신규 진입 N건 / Phase 2→3 이탈 N건 / 순유입 +N건" stat-chip 추가. 신규 진입이 5일 평균 대비 높으면 하이라이트 처리.

## 현재 구조 분석

### market_breadth_daily 테이블
- `phase1_to2_count_5d` (integer): 최근 5거래일 누계 Phase 1→2 전환 수 — **이미 존재**
- 당일 단건 카운트 (`phase1_to2_count_1d`): **없음**
- Phase 2→3 이탈 카운트 (`phase2_to3_count_1d`): **없음**

### ETL (`build-market-breadth.ts`)
- `fetchPhase1To2Count5d()`: 최근 5거래일 누계 계산 함수 존재 (line 278)
- 당일 단건 + 이탈 집계 함수 없음

### stock_phases 테이블
- `phase`, `prev_phase` 컬럼 있음 — 당일 레코드에 전환 정보 보유
- 당일 진입: `phase = 2 AND prev_phase != 2 (또는 prev_phase IS NULL)`
- 당일 이탈: `phase = 3 AND prev_phase = 2`

### 5일 평균 비교
- `phase1_to2_count_5d / 5` = 5일 일평균
- 당일 진입 > 5일 평균이면 하이라이트

### 데이터 흐름
```
build-market-breadth.ts (ETL)
  → market_breadth_daily (DB)
    → findMarketBreadthSnapshot() (repository)
      → getMarketBreadth.ts daily mode (tool)
        → run-daily-agent.ts (DailyBreadthSnapshot 변환)
          → daily-html-builder.ts (renderPhaseDistribution)
```

## 변경 사항

### 변경 1: DB 스키마 (Drizzle + Supabase migration)
`market_breadth_daily` 테이블에 컬럼 2개 추가:
- `phase1_to2_count_1d` integer — 당일 Phase 1→2 신규 진입 수
- `phase2_to3_count_1d` integer — 당일 Phase 2→3 이탈 수

### 변경 2: ETL `build-market-breadth.ts`
`fetchPhase1To2Count5d()` 옆에 당일 진입/이탈 집계 함수 추가:
```sql
-- 당일 Phase 1→2 진입
SELECT COUNT(*)::text AS count
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
WHERE sp.date = $1
  AND sp.phase = 2
  AND (sp.prev_phase != 2 OR sp.prev_phase IS NULL)
  AND s.is_actively_trading = true
  AND s.is_etf = false
  AND s.is_fund = false

-- 당일 Phase 2→3 이탈
SELECT COUNT(*)::text AS count
FROM stock_phases sp
JOIN symbols s ON sp.symbol = s.symbol
WHERE sp.date = $1
  AND sp.phase = 3
  AND sp.prev_phase = 2
  AND s.is_actively_trading = true
  AND s.is_etf = false
  AND s.is_fund = false
```
Upsert 절에 두 컬럼 추가.

### 변경 3: Repository `types.ts`
`MarketBreadthDailyRow` 인터페이스에 필드 추가:
```typescript
phase1_to2_count_1d: number | null;
phase2_to3_count_1d: number | null;
```

### 변경 4: Repository `marketBreadthRepository.ts`
`findMarketBreadthSnapshot()` 및 `findMarketBreadthSnapshots()` SELECT에 두 컬럼 추가.

### 변경 5: `dailyReportSchema.ts` — `DailyBreadthSnapshot` 인터페이스
```typescript
interface DailyBreadthSnapshot {
  // 기존 필드...
  /** 당일 Phase 1→2 신규 진입 종목 수. null = 데이터 없음 */
  phase1to2Count1d: number | null;
  /** 당일 Phase 2→3 이탈 종목 수. null = 데이터 없음 */
  phase2to3Count1d: number | null;
  /** Phase 2 순유입 = 진입 - 이탈. null = 데이터 없음 */
  phase2NetFlow: number | null;
  /** 5일 일평균 진입 수 (phase1_to2_count_5d / 5). 하이라이트 기준 */
  phase2EntryAvg5d: number | null;
}
```
`EMPTY_BREADTH_SNAPSHOT` 상수도 같이 업데이트.

### 변경 6: `getMarketBreadth.ts` — daily mode 반환값
스냅샷 히트 경로 + 폴백 경로 모두:
```typescript
phase1to2Count1d: snapshot.phase1_to2_count_1d ?? null,
phase2to3Count1d: snapshot.phase2_to3_count_1d ?? null,
phase2NetFlow: phase1to2 != null && phase2to3 != null
  ? phase1to2 - phase2to3
  : null,
phase2EntryAvg5d: snapshot.phase1_to2_count_5d != null
  ? Number((snapshot.phase1_to2_count_5d / 5).toFixed(1))
  : null,
```
폴백 경로(집계 쿼리)에서는 당일 직접 집계로 채운다 — 별도 쿼리 함수 추가.

### 변경 7: `run-daily-agent.ts` — `EMPTY_BREADTH_SNAPSHOT` 동기화
`phase1to2Count1d`, `phase2to3Count1d`, `phase2NetFlow`, `phase2EntryAvg5d` null로 초기화.

### 변경 8: `daily-html-builder.ts` — `renderPhaseDistribution`
`statsHtml` 블록에 stat-chip 추가:
```
[Phase 2 비율 ±변화] [A/D Ratio] [신고가/신저가] [Breadth Score?]
[Phase 2 진입 N건 ↑하이라이트?] [이탈 N건] [순유입 ±N건]
```
하이라이트 로직: `phase1to2Count1d > phase2EntryAvg5d * 1.5` → 진입 수 stat-chip에 up 색상 + "↑평균 대비 N배" 서브텍스트.

함수 시그니처는 변경 없음 — `DailyBreadthSnapshot`에 필드가 추가되므로 자동 포함.

## 작업 계획

### 커밋 1: DB 마이그레이션
- **무엇을**: `market_breadth_daily`에 `phase1_to2_count_1d`, `phase2_to3_count_1d` 컬럼 추가
- **파일**: Supabase migration SQL + `src/db/schema/analyst.ts`
- **완료 기준**: `yarn drizzle-kit generate` 성공, migration 적용 후 컬럼 존재 확인

### 커밋 2: ETL 집계 로직 추가
- **무엇을**: `build-market-breadth.ts`에 당일 진입/이탈 카운트 집계 + upsert 포함
- **파일**: `src/etl/jobs/build-market-breadth.ts`
- **완료 기준**: ETL 실행 후 DB에 값 채워짐

### 커밋 3: Repository 레이어 업데이트
- **무엇을**: `types.ts` 타입 + `marketBreadthRepository.ts` SELECT 확장
- **파일**: `src/db/repositories/types.ts`, `src/db/repositories/marketBreadthRepository.ts`
- **완료 기준**: TypeScript 컴파일 통과

### 커밋 4: 스키마 + 도구 레이어 업데이트
- **무엇을**: `DailyBreadthSnapshot` 인터페이스 확장, `getMarketBreadth.ts` daily 반환값 포함
- **파일**: `src/tools/schemas/dailyReportSchema.ts`, `src/tools/getMarketBreadth.ts`, `src/agent/run-daily-agent.ts`
- **완료 기준**: TypeScript 컴파일 통과, `getMarketBreadth` 단위 테스트 통과

### 커밋 5: HTML 렌더링 + 테스트 업데이트
- **무엇을**: `renderPhaseDistribution` stat-chip 추가, 하이라이트 로직, 테스트 데이터 업데이트
- **파일**: `src/lib/daily-html-builder.ts`, `src/lib/__tests__/daily-html-builder.test.ts`
- **완료 기준**: 테스트 통과, HTML에 진입/이탈/순유입 표시 확인

## 리스크

1. **prev_phase 신뢰도**: `stock_phases.prev_phase`는 ETL이 채우지만, 신규 상장 또는 ETL 최초 실행일은 `prev_phase = NULL`일 수 있다. 당일 진입 집계 쿼리에서 `prev_phase IS NULL`을 진입으로 처리할지 제외할지 결정 필요.
   - **판단**: `prev_phase IS NULL`은 진입으로 보지 않는다 — `prev_phase != 2`만 카운트. 신규 종목 잡음 방지.

2. **폴백 경로 추가 쿼리**: `getMarketBreadth.ts` 폴백(집계 쿼리) 경로에서 당일 진입/이탈를 집계하려면 `marketBreadthRepository.ts`에 전용 함수 2개 추가 필요. 폴백은 드물게 실행되므로 성능 문제 없음.

3. **5일 평균 계산**: `phase1_to2_count_5d / 5`는 주말/휴장일을 고려하지 않아 정확한 일평균이 아니다. 5거래일 누계이므로 `/ 5`는 "5거래일 일평균"으로 표기하면 오해 없음.

4. **하이라이트 임계값**: `1.5배` 기준은 경험적 값이다. 너무 자주 하이라이트되면 노이즈가 된다. 구현 후 실데이터로 검증 후 조정 가능.

## 의사결정 필요

없음 — 리스크 1의 `prev_phase IS NULL` 처리 방향을 위에서 자율 판단했다. 임계값(1.5배)도 구현 후 수정 가능한 상수이므로 CEO 판단 불필요.
