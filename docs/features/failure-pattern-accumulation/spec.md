# 실패 패턴 + 위양성 통합 축적 시스템 (N-1e)

이슈: #79
RFC 참조: `docs/RFC-narrative-layer.md` 제안 2, 제안 7
선행 기획서: `docs/features/narrative-layer-wave1-completion/spec.md` (N-1c, N-1d)

---

## 선행 맥락

**Wave 1에서 완료된 사항 (PR #82, #84):**
- N-1a: 수요-공급-병목 프레임 4가지 질문이 라운드1 프롬프트에 주입됨
- N-1b: `theses.category` 컬럼 추가 (structural_narrative / sector_rotation / short_term_outlook)
- N-1c: `theses.next_bottleneck` 컬럼 추가, 라운드3에서 N+1 병목 예측 추출
- N-1d: `theses.consensus_score`, `theses.dissent_reason` 컬럼 추가, 합의도 추적

**현재 학습 루프의 공백:**
- `promote-learnings.ts`는 CONFIRMED thesis에서 반복 패턴만 `agent_learnings`로 승격함
- INVALIDATED thesis는 `missCount` 업데이트에만 쓰이고, 실패 원인 구조화는 없음
- `recommendations` 테이블에 Phase 2 진입 후 Phase 1 회귀 여부를 별도로 추적하지 않음
- `signal_log` 테이블에 `phaseExitDate`, `phaseExitReturn`이 있지만 실패 패턴 분류와 연결되지 않음
- `memoryLoader.ts`는 `agent_learnings.category = 'confirmed'`만 로드하며, 경계 패턴(caution 카테고리) 섹션이 비어 있음

**도구 검증 결과 (PR #61, 2026-03-07):**
- Phase 1 후기 → Phase 2 전환율 41.9% → 58.1%가 실패하는 위양성
- 섹터 RS 동반 여부가 가장 유의미한 필터. 단독 도구보다 교집합이 강력하다는 증거
- 위양성의 조건별 분류가 없어 "어떤 조건일 때 주로 실패하는가"를 알 수 없음

**메모리 검색 결과 (`memory/chief-of-staff.md`):**
> "도구를 만든 후 작동하는지 정량 검증하는 루프가 없으면 false positive가 방치된다."

이 기획서는 그 교훈의 직접적인 구현이다.

---

## 골 정렬

**ALIGNED** — 직접 기여.

위양성(Phase 2 신호 후 회귀)을 줄이는 것은 정밀도 향상의 핵심이다. 58.1%의 실패 케이스에서 공통 조건(시장 브레드스 악화, 섹터 고립 상승, 거래량 미확인)을 추출하여 필터링 규칙으로 승격하면, Phase 2 초입 포착의 신뢰도가 직접 향상된다.

성공 패턴 학습과 실패 패턴 학습은 같은 학습 루프의 두 방향이다. 성공만 학습하는 현재 구조는 절반짜리 학습 루프다.

---

## 문제

현재 시스템은 "맞은 것"에서만 학습한다. CONFIRMED thesis → `agent_learnings` 승격 루프는 동작하지만, INVALIDATED thesis와 Phase 2 회귀 종목에서 공통 패턴을 추출하는 루프가 없다.

구체적으로:
1. 어떤 시장 조건(브레드스 방향, 섹터 동반 여부, 거래량)에서 Phase 2 신호가 실패하는지 정량화되지 않음
2. 실패 패턴이 토론 프롬프트에 "경계 패턴"으로 주입되지 않아 같은 실수가 반복될 수 있음
3. 위양성 비율(58.1%)은 알고 있지만, 비용(최대 역행 폭, 회귀 소요 기간)이 측정되지 않음

---

## Before → After

**Before**

- `failure_patterns` 테이블 없음. 실패 조건이 구조화되지 않음.
- `recommendations` 테이블: `closeReason`이 있지만 실패 시점 시장 조건이 기록되지 않음.
- `signal_log` 테이블: `phaseExitDate`, `phaseExitReturn`이 있지만 실패 조건 분류 없음.
- `memoryLoader.ts`: 경계 패턴 섹션이 비어 있음 (`caution` 카테고리 learnings 없음).
- `promote-learnings.ts`: CONFIRMED 기반 승격만. INVALIDATED 기반 경계 패턴 승격 로직 없음.
- 위양성 지표 없음: `phase2_signal_then_reverted`, `max_adverse_move`, `time_to_revert` 미측정.

**After**

- `failure_patterns` 테이블: 조건 조합별 실패율 + 이항 검정 유의성 저장.
- `recommendations` 테이블: `failureConditions` (JSON) 컬럼 추가 — 실패 시 시장 조건 스냅샷.
- `signal_log` 테이블: `phase2Reverted` (boolean), `timeToRevert` (integer, 일수), `maxAdverseMove` (numeric) 컬럼 추가.
- `memoryLoader.ts`: `caution` 카테고리 learnings를 "경계 패턴"으로 로드하여 토론 프롬프트에 주입.
- `promote-learnings.ts`: INVALIDATED 기반 경계 패턴 승격 로직 추가 — 실패율 70%+ + 통계 유의성 조건.
- ETL: `collect-failure-patterns.ts` — Phase 2 실패 종목을 주기적으로 수집하고 조건 조합별 실패율 산출.

---

## 변경 사항

### 1. DB 스키마 — `failure_patterns` 테이블 신설

```typescript
// src/db/schema/analyst.ts 에 추가
export const failurePatterns = pgTable("failure_patterns", {
  id: serial("id").primaryKey(),
  patternName: text("pattern_name").notNull(),        // "브레드스 악화 중 Phase 2 신호"
  conditions: text("conditions").notNull(),            // JSON: FailureConditions
  failureCount: integer("failure_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  failureRate: numeric("failure_rate"),                // 0.00 ~ 1.00
  significance: numeric("significance"),               // p-value (이항 검정)
  cohenH: numeric("cohen_h"),                          // 효과 크기
  isActive: boolean("is_active").default(true),        // 70%+ + significant → true
  lastUpdated: text("last_updated"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

`FailureConditions` JSON 스키마:
```typescript
interface FailureConditions {
  marketBreadthDirection: "improving" | "declining" | "neutral" | null;
  sectorRsIsolated: boolean | null;    // 인접 섹터 미동반 여부
  volumeConfirmed: boolean | null;     // 거래량 확인 여부
  sepaGrade: "S" | "A" | "B" | "C" | "F" | null;
}
```

### 2. DB 스키마 — `signal_log` 테이블 확장

기존 `signal_log`에 위양성 지표 컬럼 추가:
```typescript
phase2Reverted: boolean("phase2_reverted"),         // Phase 2 → Phase 1/4 회귀 여부
timeToRevert: integer("time_to_revert"),             // 신호 발생 ~ 회귀 소요 일수
maxAdverseMove: numeric("max_adverse_move"),         // 추천 후 최대 역행 폭 (%)
failureConditions: text("failure_conditions"),        // JSON: FailureConditions (실패 시점 스냅샷)
```

### 3. DB 스키마 — `recommendations` 테이블 확장

```typescript
failureConditions: text("failure_conditions"),        // JSON: FailureConditions (Phase 1 회귀 시 저장)
phase2RevertDate: text("phase2_revert_date"),         // Phase 2 → 회귀 시점
maxAdverseMove: numeric("max_adverse_move"),          // 추천 후 최대 역행 폭 (%)
```

### 4. ETL — `src/etl/jobs/collect-failure-patterns.ts` 신설

핵심 로직:
1. `signal_log`에서 `phase2Reverted = true` 레코드 수집 (실패 사례)
2. 각 실패 사례의 `failureConditions`에서 조건 조합 추출
3. 조건 조합별 실패율 산출 (실패 수 / 전체 해당 조건 수)
4. `binomialTest` 적용 — p < 0.05 + Cohen's h >= 0.3 인 패턴만 유의
5. 실패율 70%+ AND 유의한 패턴 → `failure_patterns` upsert

조건 조합 키 예시:
- `"breadth:declining|sector_isolated:true"` — 브레드스 악화 + 섹터 고립
- `"volume:false|breadth:declining"` — 거래량 미확인 + 브레드스 악화
- `"sepa:C-F|sector_isolated:true"` — 펀더멘탈 부실 + 섹터 고립

### 5. ETL — 기존 `update-signal-log.ts` (또는 동등한 ETL) 확장

기존 일간 ETL이 `signal_log`를 업데이트할 때:
- Phase 2 → Phase 1 회귀 감지 시 `phase2Reverted = true`, `timeToRevert`, `maxAdverseMove` 업데이트
- 회귀 시점의 시장 조건을 `failureConditions`에 저장:
  - `sectorRsDaily`에서 해당 섹터 RS 방향 및 인접 섹터 동반 여부 계산
  - `stock_phases`에서 `volumeConfirmed` 참조
  - `fundamental_scores`에서 `sepaGrade` 참조
  - 시장 브레드스: `sector_rs_daily.phase2_ratio` 추세로 판단

### 6. `promote-learnings.ts` 확장 — 경계 패턴 승격

```typescript
// 기존 확인 패턴(CONFIRMED 기반) 승격 로직 유지
// 신규: INVALIDATED 기반 경계 패턴 승격 로직 추가

const FAILURE_RATE_THRESHOLD = 0.70;   // 실패율 70%+
const MIN_FAILURE_OBSERVATIONS = 8;    // 최소 8회 관측

async function promoteFailurePatterns(today: string): Promise<number>
```

승격된 경계 패턴은 `agent_learnings`에 `category = 'caution'`으로 저장.

`principle` 형식: `"[경계] {조건 설명} 조건에서 Phase 2 신호 실패율 {실패율}% ({총 관측}회 관측)"`

### 7. `memoryLoader.ts` 확장 — 경계 패턴 주입

```typescript
// loadLearnings() 내부 확장
const caution = rows.filter((r) => r.category === "caution");

if (caution.length > 0) {
  lines.push("### 경계 패턴 (이 조건에서는 Phase 2 신호 신뢰도 낮음)");
  lines.push("아래 조건이 감지되면 추천 전 추가 검증 필요:");
  for (const r of caution) {
    const failureRate = r.hitRate != null
      ? ` (실패율 ${((1 - Number(r.hitRate)) * 100).toFixed(0)}%, ${r.hitCount + r.missCount}회 관측)`
      : "";
    lines.push(`- ${r.principle}${failureRate}`);
  }
}
```

주의: `caution` 카테고리는 기존 `hitRate`를 역방향으로 해석한다. `hitCount`가 실패 횟수, `missCount`가 성공 횟수로 저장 (기존 스키마 재활용, 의미만 역전).

**설계 결정**: 신규 `failure_patterns` 테이블에서 계산된 패턴은 토론 프롬프트 주입을 위해 `agent_learnings(caution)` 테이블로 복사된다. 두 테이블의 역할은 다르다:
- `failure_patterns`: 조건 조합별 실패율 원시 데이터 저장소 (통계 집계 전용)
- `agent_learnings(caution)`: 토론 프롬프트 주입용 학습 (기존 memoryLoader 인프라 활용)

### 8. 타입 정의 — `src/types/failure.ts` 신설

```typescript
export interface FailureConditions {
  marketBreadthDirection: "improving" | "declining" | "neutral" | null;
  sectorRsIsolated: boolean | null;
  volumeConfirmed: boolean | null;
  sepaGrade: "S" | "A" | "B" | "C" | "F" | null;
}

export interface FailurePatternRow {
  patternName: string;
  conditions: FailureConditions;
  failureCount: number;
  totalCount: number;
  failureRate: number;
  significance: number;   // p-value
  cohenH: number;
  isActive: boolean;
}
```

---

## 작업 계획

### 태스크 1 — DB 스키마 + 마이그레이션 [실행팀]

**변경 파일:**
- `src/db/schema/analyst.ts`:
  - `failurePatterns` 테이블 신설 (7개 컬럼)
  - `signalLog`에 4개 컬럼 추가 (`phase2Reverted`, `timeToRevert`, `maxAdverseMove`, `failureConditions`)
  - `recommendations`에 3개 컬럼 추가 (`failureConditions`, `phase2RevertDate`, `maxAdverseMove`)
- `src/types/failure.ts`: `FailureConditions`, `FailurePatternRow` 타입 신설

**완료 기준:**
- `drizzle-kit generate` 후 마이그레이션 SQL 생성
- `drizzle-kit migrate` 후 Supabase DB에 컬럼/테이블 적용 확인
- 기존 rows에는 새 컬럼 null — 기존 기능 영향 없음

**의존성:** 없음 (독립 태스크)

---

### 태스크 2 — 시장 조건 수집 헬퍼 [실행팀]

**변경 파일:** `src/lib/marketConditionCollector.ts` 신설

**기능:**
- `collectFailureConditions(symbol: string, date: string): Promise<FailureConditions>`
  - `sectorRsDaily`에서 해당 섹터 4주 RS 추세로 `marketBreadthDirection` 판단
  - 동일 날짜 인접 섹터(RS 상위 5개) 중 동반 상승 섹터 비율로 `sectorRsIsolated` 판단
  - `stockPhases`에서 `volumeConfirmed` 조회
  - `fundamentalScores`에서 최근 `grade` 조회 → `sepaGrade`

**완료 기준:**
- 단위 테스트: 각 조건 판단 로직에 대한 테스트 (DB mock 사용)
- `sectorRsIsolated` 기준: 인접 상위 5개 섹터 중 동반 RS 상승 < 2개이면 고립으로 판단

**의존성:** 태스크 1 (타입 참조)

---

### 태스크 3 — signal_log ETL 확장 [실행팀]

**변경 파일:** `src/etl/jobs/update-signal-log.ts` (기존 파일 탐색 후 확인) 또는 `src/etl/jobs/track-phase-exits.ts` 신설

**기능:**
- 매일 실행되는 ETL에서 `signal_log.status = 'ACTIVE'` 레코드를 순회하며:
  - `stock_phases`에서 현재 phase 조회
  - Phase 2 → Phase 1 또는 Phase 4 전환 감지 → `phase2Reverted = true`
  - `timeToRevert`: `entryDate` ~ 전환일 일수 계산
  - `maxAdverseMove`: `entryPrice` 대비 최저가 비율 (%)
  - `failureConditions`: 전환 시점 시장 조건 수집 (태스크 2 헬퍼 호출)

**완료 기준:**
- Phase 2 → Phase 1 회귀를 올바르게 감지하는 단위 테스트
- `maxAdverseMove`가 0 이상 값 (역행이 없으면 0)
- 기존 `signal_log` 업데이트 로직과 충돌 없음

**의존성:** 태스크 1, 2

---

### 태스크 4 — 실패 패턴 수집 ETL 신설 [실행팀]

**변경 파일:** `src/etl/jobs/collect-failure-patterns.ts` 신설

**기능:**
```
1. signal_log에서 phase2Reverted = true 레코드 전체 로드
2. 각 레코드의 failureConditions 파싱
3. 조건 조합 키 생성 (JSON 직렬화 후 정렬된 키)
4. 조합별 (실패 수 / 전체 해당 조합 수) 산출
   - 전체 해당 조합 수: 동일 조건 조합을 가진 signal_log 레코드 수 (성공 포함)
5. binomialTest(failureCount, totalCount, 0.5) 적용
6. failureRate >= 0.70 AND isSignificant → failure_patterns upsert
7. 기존 활성 패턴 중 failureRate < 0.70 또는 !isSignificant → isActive = false
```

**완료 기준:**
- `binomialTest`와 동일한 기준 (기존 `statisticalTests.ts` 재활용)
- 조건 조합 키 생성 로직에 대한 단위 테스트
- 실패율 산출 정확성 테스트

**의존성:** 태스크 1, 2, 3

---

### 태스크 5 — promote-learnings 확장 [실행팀]

**변경 파일:** `src/etl/jobs/promote-learnings.ts`

**기능:**
- 기존 CONFIRMED 기반 승격 로직 유지
- 신규 `promoteFailurePatterns(today: string)` 함수 추가:
  - `failure_patterns.isActive = true` 인 패턴을 로드
  - `agent_learnings(category = 'caution')`에 이미 없는 패턴만 신규 삽입
  - 기존 caution learning 중 연결된 failure_pattern이 비활성화된 경우 강등

**주의:** `caution` 카테고리의 `hitCount`/`missCount`는 실패 횟수/성공 횟수로 역방향 저장. `hitRate`는 "실패율 기준 hitRate" — memoryLoader가 해석할 때 역방향임을 명시.

**대안 검토:** 별도 `failureRate` 컬럼을 `agent_learnings`에 추가하는 것도 고려했으나, 기존 스키마 변경 최소화를 위해 역방향 해석 방식을 채택. 혼란을 방지하기 위해 `principle` 텍스트에 `[경계]` 프리픽스를 명시.

**완료 기준:**
- 기존 CONFIRMED 승격 기능 회귀 없음
- `caution` 카테고리 learning이 올바르게 생성되는 단위 테스트
- 편향 감지(`detectBullBias`)가 caution 항목도 처리하는지 확인 — BEAR_KEYWORDS가 경계 문구에 포함되어야 함

**의존성:** 태스크 4

---

### 태스크 6 — memoryLoader 확장 [실행팀]

**변경 파일:** `src/agent/debate/memoryLoader.ts`

**기능:**
- `loadLearnings()` 내부에 `caution` 카테고리 섹션 추가
- 섹션 제목: `"### 경계 패턴 (이 조건에서는 Phase 2 신호 신뢰도 낮음)"`
- 각 경계 패턴을 `hitRate`(실패율)와 함께 출력
- XML 태그 내 프롬프트 인젝션 방지 처리 유지 (`<\/memory-context>` 제거)

**완료 기준:**
- `caution` 학습이 있을 때 경계 패턴 섹션이 포함된 문자열 반환
- `caution` 학습이 없을 때 기존 출력과 동일

**의존성:** 태스크 5

---

### 태스크 7 — 테스트 [실행팀]

**변경 파일:**
- `src/lib/__tests__/marketConditionCollector.test.ts` 신설
- `src/etl/jobs/__tests__/collect-failure-patterns.test.ts` 신설
- `src/etl/jobs/__tests__/promote-learnings.test.ts` 확장 (caution 승격 케이스 추가)
- `src/agent/debate/__tests__/memoryLoader.test.ts` 확장 (caution 섹션 케이스 추가)

**완료 기준:**
- 기존 테스트 전체 통과 (현재 555개)
- 신규 테스트 최소 20개 추가
- 전체 커버리지 80% 이상 유지
- 핵심 테스트 케이스:
  - 브레드스 악화 + 섹터 고립 조건에서 실패율 70% 이상 패턴이 `failure_patterns`에 저장됨
  - 통계적으로 유의하지 않은 패턴은 `isActive = false`로 저장됨
  - `memoryLoader`가 caution learning을 "경계 패턴" 섹션으로 출력함
  - `phase2Reverted` 감지 로직이 Phase 2 → Phase 1 전환을 올바르게 처리함

**의존성:** 태스크 2~6

---

## 병렬 실행 계획

```
태스크 1 (DB 스키마 + 마이그레이션)
       │
       ├── 태스크 2 (시장 조건 수집 헬퍼)
       │           │
       │           └── 태스크 3 (signal_log ETL 확장)
       │                         │
       │                         └── 태스크 4 (실패 패턴 수집 ETL)
       │                                       │
       │                                       └── 태스크 5 (promote-learnings 확장)
       │                                                     │
       │                                                     └── 태스크 6 (memoryLoader 확장)
       │
       └─────────────────────────────────────── 태스크 7 (테스트, 태스크 2~6 완료 후)
```

태스크 1 완료 후 태스크 2 시작. 이후 3 → 4 → 5 → 6은 순차 의존성. 태스크 7은 전체 완료 후.

---

## 리스크

1. **caution 카테고리의 hitRate 역방향 해석**: 기존 `agent_learnings` 스키마는 `hitRate`를 적중률(높을수록 좋음)로 사용하지만, caution 카테고리에서는 실패율(높을수록 위험)로 역방향 저장한다. `memoryLoader`, `promote-learnings`, `updateLearningStats`에서 카테고리 분기 처리가 누락되면 버그 발생. 모든 참조 지점에서 `category === 'caution'` 분기를 명시적으로 처리해야 한다.
   - **완화**: `principle` 필드에 `[경계]` 프리픽스를 항상 포함시켜 용도를 명시. `biasDetector`는 caution 항목에 BEAR_KEYWORDS가 포함되어야 bull-bias 계산이 균형잡힌다.

2. **초기 데이터 부족**: Phase 2 회귀 데이터가 `signal_log`에 실시간 축적되어야 통계 검증이 가능하다. 현재 `signal_log`에 역사적 데이터가 얼마나 있는지 불확실. 초기에는 `failure_patterns` 테이블이 비어 있을 수 있으며, 의미 있는 패턴 승격까지 수주가 필요할 수 있다.
   - **완화**: ETL은 빈 `failure_patterns`도 정상 처리. memoryLoader는 caution 학습이 없으면 해당 섹션을 출력하지 않음.

3. **`updateLearningStats` 로직과의 충돌**: `promote-learnings.ts`의 `updateLearningStats`는 `sourceThesisIds` 기반으로 hitCount/missCount를 재계산한다. caution 카테고리는 `sourceThesisIds`가 아닌 `failure_patterns`에서 파생되므로, 기존 재계산 로직이 caution 항목을 잘못 처리할 수 있다.
   - **완화**: `updateLearningStats`에 `category !== 'caution'` 조건 추가. caution 항목은 별도의 `updateCautionStats` 함수로 관리.

4. **조건 조합 폭발**: 4개 조건(breadth, isolated, volume, sepa)의 조합이 최대 3×2×2×5 = 60가지다. 대부분 관측 수가 부족해 통계 검증 통과가 어렵다. 이항 검정의 최소 관측 기준(`MIN_FAILURE_OBSERVATIONS = 8`)이 자연 필터 역할을 하므로 실질적으로 승격되는 패턴은 소수.
   - **완화**: 초기에는 단순 조합(2개 조건 이하)에서 먼저 패턴이 나타날 것으로 예상. 조건 조합 키를 2개 이하로 제한하는 옵션 검토.

5. **시장 브레드스 방향 판단 기준**: `marketBreadthDirection`을 `sector_rs_daily.phase2_ratio` 추세로 판단하려면 몇 주 데이터가 필요한가의 기준이 명확하지 않다. 4주 이동평균 기울기를 사용하는 방안이 현실적.
   - **완화**: 태스크 2에서 기준을 코드와 테스트에 명시적으로 정의. 이후 QA 에이전트가 기준의 타당성을 검증.

---

## 의사결정 필요

없음 — 바로 구현 가능.

RFC 제안 2 및 제안 7, 이슈 #79의 요구사항이 모두 명확하다. 유일한 설계 결정(caution 역방향 해석 vs 신규 컬럼 추가)은 기존 스키마 변경 최소화를 우선하여 역방향 해석 방식으로 자율 결정한다.
