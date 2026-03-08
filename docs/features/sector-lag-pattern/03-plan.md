# 구현 계획 — 섹터 간 시차(Lag) 패턴 축적

**이슈**: #93
**날짜**: 2026-03-08

---

## 파일 변경 목록

| 파일 | 변경 유형 | 담당 |
|------|---------|------|
| `src/db/schema/analyst.ts` | 수정 — 테이블 2개 추가 | 구현팀 |
| `src/etl/jobs/detect-sector-phase-events.ts` | 신규 | 구현팀 |
| `src/etl/jobs/update-sector-lag-patterns.ts` | 신규 | 구현팀 |
| `src/lib/sectorLagStats.ts` | 신규 | 구현팀 |
| `src/agent/run-weekly-agent.ts` | 수정 — 프롬프트 주입 추가 | 구현팀 |
| `src/agent/systemPrompt.ts` | 수정 — `sectorLagContext` 파라미터 추가 | 구현팀 |
| `src/tests/sectorLagStats.test.ts` | 신규 | 구현팀 |
| `src/tests/detectSectorPhaseEvents.test.ts` | 신규 | 구현팀 |
| Drizzle 마이그레이션 파일 | 자동 생성 | 구현팀 |

---

## Phase 1: DB 스키마 + 마이그레이션

**예상 시간**: 2시간
**완료 조건**: 두 테이블이 Supabase에 존재하고 `drizzle-kit` 타입 오류 없음

### 1-1. `src/db/schema/analyst.ts` 수정

`sectorPhaseEvents` 테이블 추가:

```typescript
export const sectorPhaseEvents = pgTable(
  "sector_phase_events",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),
    entityType: text("entity_type").notNull(), // 'sector' | 'industry'
    entityName: text("entity_name").notNull(),
    fromPhase: smallint("from_phase").notNull(),
    toPhase: smallint("to_phase").notNull(),
    avgRs: numeric("avg_rs"),
    phase2Ratio: numeric("phase2_ratio"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_sector_phase_events").on(
      t.date, t.entityType, t.entityName, t.fromPhase, t.toPhase
    ),
    idxEntityPhase: index("idx_sector_phase_events_entity_phase").on(
      t.entityType, t.entityName, t.toPhase, t.date
    ),
    idxDateType: index("idx_sector_phase_events_date_type").on(
      t.date, t.entityType, t.toPhase
    ),
  })
);
```

`sectorLagPatterns` 테이블 추가:

```typescript
export const sectorLagPatterns = pgTable(
  "sector_lag_patterns",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    leaderEntity: text("leader_entity").notNull(),
    followerEntity: text("follower_entity").notNull(),
    transition: text("transition").notNull(), // '1to2' | '3to4'
    sampleCount: integer("sample_count").notNull().default(0),
    avgLagDays: numeric("avg_lag_days"),
    medianLagDays: numeric("median_lag_days"),
    stddevLagDays: numeric("stddev_lag_days"),
    minLagDays: integer("min_lag_days"),
    maxLagDays: integer("max_lag_days"),
    isReliable: boolean("is_reliable").default(false),
    lastObservedAt: text("last_observed_at"),
    lastLagDays: integer("last_lag_days"),
    lastUpdated: text("last_updated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_sector_lag_patterns").on(
      t.entityType, t.leaderEntity, t.followerEntity, t.transition
    ),
    idxLeader: index("idx_sector_lag_patterns_leader").on(
      t.entityType, t.leaderEntity, t.transition
    ),
  })
);
```

### 1-2. Drizzle 마이그레이션 실행

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Phase 2: 이벤트 탐지 ETL (`detect-sector-phase-events.ts`)

**예상 시간**: 4시간 (소급 처리 포함)
**완료 조건**: 기존 전체 데이터 소급 완료, 중복 없음, 단위 테스트 통과

### 2-1. 핵심 구현

```typescript
// src/etl/jobs/detect-sector-phase-events.ts

interface PhaseEventRow {
  date: string;
  entity_type: 'sector' | 'industry';
  entity_name: string;
  from_phase: number;
  to_phase: number;
  avg_rs: string | null;
  phase2_ratio: string | null;
}

/**
 * sector_rs_daily에서 Phase 전이 이벤트 탐지 후 sector_phase_events에 UPSERT.
 * mode: 'backfill' — 전체 기간 소급 (최초 1회)
 * mode: 'incremental' — 최신 날짜만 처리 (매일)
 */
async function detectSectorPhaseEvents(mode: 'backfill' | 'incremental')

/**
 * industry_rs_daily에 대해 동일 실행
 */
async function detectIndustryPhaseEvents(mode: 'backfill' | 'incremental')
```

**이벤트 탐지 조건:**
```sql
-- sector_rs_daily에서 전이 이벤트 추출
SELECT date, sector AS entity_name,
       prev_group_phase AS from_phase, group_phase AS to_phase,
       avg_rs, phase2_ratio
FROM sector_rs_daily
WHERE prev_group_phase IS NOT NULL
  AND group_phase != prev_group_phase
  -- incremental 모드: AND date = $targetDate
ORDER BY date
```

### 2-2. 소급 처리 실행 방법

초기 실행 시 npm 스크립트로 소급 처리:
```bash
npx tsx src/etl/jobs/detect-sector-phase-events.ts --backfill
```

이후 매일 ETL 파이프라인에 incremental 모드로 추가.

### 2-3. ETL 파이프라인 통합

`package.json`의 ETL 스크립트 또는 GitHub Actions workflow에 추가:
```
etl:sector-lag → detect-sector-phase-events + update-sector-lag-patterns
```

---

## Phase 3: 시차 통계 계산 ETL (`update-sector-lag-patterns.ts`)

**예상 시간**: 4시간
**완료 조건**: 섹터 쌍별 시차 통계가 정확히 계산됨, `is_reliable` 플래그 정확

### 3-1. `src/lib/sectorLagStats.ts` 유틸리티

```typescript
const MIN_SAMPLE = 5;
const LAG_SEARCH_WINDOW_DAYS = 180;

interface LagObservation {
  leaderDate: string;
  followerDate: string;
  lagDays: number;
}

/**
 * 리더 이벤트 시계열과 팔로워 이벤트 시계열에서 시차 관측을 계산.
 * - 팔로워가 리더보다 나중에 진입한 경우(lagDays > 0)만 유효
 * - LAG_SEARCH_WINDOW_DAYS 이내에 발생한 팔로워 이벤트만 매칭
 * - 하나의 리더 이벤트에 가장 가까운 팔로워 1개만 매칭
 */
export function calculateLagObservations(
  leaderDates: string[],
  followerDates: string[],
): LagObservation[]

/**
 * lag_days 배열에서 통계 계산.
 */
export function calculateLagStats(lagDays: number[]): {
  avgLagDays: number;
  medianLagDays: number;
  stddevLagDays: number;
  minLagDays: number;
  maxLagDays: number;
  isReliable: boolean;
} | null  // 샘플 MIN_SAMPLE 미만 시 null

/**
 * 현재 활성 선행 섹터 경보 생성.
 * - 최근 N일 내 Phase 2 진입한 리더 섹터 조회
 * - is_reliable 패턴만 포함
 * - 아직 Phase 2에 진입하지 않은 팔로워만 포함
 */
export async function getActiveLeadingAlerts(
  currentDate: string,
  lookbackDays?: number, // 기본 14일
): Promise<ActiveLeadingAlert[]>

/**
 * 주간 에이전트 프롬프트 주입용 포맷.
 * 알림이 없으면 빈 문자열 반환.
 */
export async function formatLeadingSectorsForPrompt(
  currentDate: string,
): Promise<string>
```

### 3-2. `update-sector-lag-patterns.ts` 핵심 로직

```
1. sector_phase_events에서 모든 리더 후보 목록 조회
   (to_phase = 2, entity_type = 'sector' 기준 group by entity_name)

2. 각 리더에 대해:
   a. 리더의 모든 Phase 2 진입 날짜 목록
   b. 각 잠재 팔로워(자신 제외한 모든 섹터)에 대해:
      - 팔로워의 Phase 2 진입 날짜 목록
      - calculateLagObservations() 호출
      - calculateLagStats() 호출
   c. sector_lag_patterns UPSERT

3. industry 레벨에 대해 동일 반복

주의: N×N 매트릭스 계산이므로 섹터 수가 10~12개라면
약 10×10 = 100개 쌍. 충분히 관리 가능한 규모.
```

---

## Phase 4: 주간 에이전트 연동 + 테스트

**예상 시간**: 3시간
**완료 조건**: 프롬프트 주입 정상 동작, 단위 테스트 통과

### 4-1. `run-weekly-agent.ts` 수정

```typescript
// 기존 패턴과 동일한 구조로 추가
let sectorLagContext = "";
try {
  sectorLagContext = await formatLeadingSectorsForPrompt(targetDate);
  if (sectorLagContext !== "") {
    logger.info("SectorLag", "선행 섹터 시차 경보 로드 완료");
  }
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error("SectorLag", `로드 실패 (에이전트는 계속 진행): ${reason}`);
}

// buildWeeklySystemPrompt 호출에 추가
const config: AgentConfig = {
  systemPrompt: buildWeeklySystemPrompt({
    fundamentalSupplement,
    thesesContext,
    signalPerformance,
    narrativeChainsSummary,
    sectorLagContext,  // 추가
  }),
  // ...
};
```

### 4-2. `systemPrompt.ts` 수정

`buildWeeklySystemPrompt`의 options 타입에 `sectorLagContext?: string` 추가.

### 4-3. 단위 테스트

**`src/tests/sectorLagStats.test.ts`:**

```typescript
describe('calculateLagObservations', () => {
  it('음수 시차를 제외한다 (팔로워가 먼저 진입한 경우)')
  it('탐색 윈도우(180일)를 초과한 팔로워를 제외한다')
  it('하나의 리더 이벤트에 가장 가까운 팔로워 1개만 매칭한다')
  it('동시 진입(lag = 0)을 포함한다')
  it('팔로워 이벤트가 없으면 빈 배열을 반환한다')
})

describe('calculateLagStats', () => {
  it('샘플 5개 미만이면 null을 반환한다')
  it('샘플 5개 이상이면 평균/중앙값/표준편차를 계산한다')
  it('is_reliable이 샘플 수 기준으로 정확히 설정된다')
  it('평균과 중앙값이 올바르게 계산된다')
})

describe('formatLeadingSectorsForPrompt', () => {
  it('신뢰 가능한 패턴이 없으면 빈 문자열을 반환한다')
  it('팔로워가 이미 Phase 2에 있으면 경보에 포함하지 않는다')
})
```

**`src/tests/detectSectorPhaseEvents.test.ts`:**

```typescript
describe('이벤트 탐지 조건', () => {
  it('prevGroupPhase가 null이면 이벤트를 생성하지 않는다')
  it('from_phase == to_phase이면 이벤트를 생성하지 않는다')
  it('Phase 1→2 전이를 정확히 탐지한다')
  it('Phase 3→4 전이도 탐지한다')
  it('동일 이벤트를 중복 삽입하지 않는다 (UPSERT)')
})
```

---

## 실행 순서 (종속성)

```
Phase 1 (DB)
    ↓
Phase 2 (이벤트 ETL) — 소급 처리 포함
    ↓
Phase 3 (시차 통계) — Phase 2 완료 후 데이터 있어야 의미 있음
    ↓
Phase 4-A (에이전트 연동) || Phase 4-B (테스트) — 병렬 가능
```

---

## ETL 파이프라인 통합 위치

기존 ETL 실행 순서에서 `build-sector-rs.ts`와 `build-industry-rs.ts` 다음에 추가:

```
1. load-daily-prices.ts
2. build-daily-ma.ts
3. build-rs.ts
4. build-sector-rs.ts      ← 기존
5. build-industry-rs.ts    ← 기존
6. build-stock-phases.ts   ← 기존
7. detect-sector-phase-events.ts  ← 신규 (6번 완료 후)
8. update-sector-lag-patterns.ts  ← 신규 (7번 완료 후)
```

---

## 초기 소급 처리 실행 계획

최초 배포 시:

1. Phase 1 완료 (테이블 생성)
2. `detect-sector-phase-events.ts --backfill` 실행 — 전체 기간 소급
3. `update-sector-lag-patterns.ts` 실행 — 소급된 이벤트 기반 통계 계산
4. 결과 확인: `is_reliable = true`인 패턴이 있는지 확인 (없으면 예상된 상황 — 데이터 축적 필요)
5. 이후 매일 incremental 모드로 자동 실행

소급 처리 결과 예상:
- `sector_phase_events`: 과거 이벤트들이 채워짐
- `sector_lag_patterns`: 초기에는 대부분 `is_reliable = false`일 가능성 높음
- 6~12개월 운영 후 `is_reliable = true` 패턴이 나타나기 시작할 것으로 기대

---

## 완료 기준 (PR 검증)

코드 리뷰어가 확인할 사항:
- [ ] `sector_phase_events` 테이블 스키마가 spec과 일치
- [ ] `sector_lag_patterns` 테이블 스키마가 spec과 일치
- [ ] `prevGroupPhase is null` 가드가 이벤트 탐지 로직에 있음
- [ ] `from_phase == to_phase` 가드가 있음
- [ ] 음수 시차 제외 로직이 `calculateLagObservations`에 있음
- [ ] `is_reliable` 플래그가 `MIN_SAMPLE = 5` 기준으로 설정됨
- [ ] `formatLeadingSectorsForPrompt`: 패턴 없으면 빈 문자열 반환 확인
- [ ] `run-weekly-agent.ts`: 에러 발생 시 에이전트 계속 진행 (에러 격리)
- [ ] 단위 테스트 커버리지 80% 이상
- [ ] 기존 ETL 테스트 전체 통과
