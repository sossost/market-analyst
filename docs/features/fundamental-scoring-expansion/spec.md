# 펀더멘탈 스코어링 전체 종목 확장 + DB 저장

GitHub Issue: #66

## 선행 맥락

**F7 (fundamental-validation) 완료 이력**
- `docs/features/fundamental-validation/` 문서 3종 존재 (spec / decisions / plan)
- PR #26 머지로 Phase 2 종목 대상 SEPA 스코어링 구현 완료
- 스코어 저장은 파일 캐시(`data/fundamental-cache/{date}.json`)로만 구현됨
- LLM 분석은 S등급만 수행 (A/B는 PR #618570으로 제거)

**초입 포착 도구 검증 결과 (#58, PR #61)**
- 교집합 필터가 단독 도구보다 강력하다는 것이 실증됨
- `getFundamentalAcceleration`이 Phase 1 교집합 30.6% 달성 — 교집합에 펀더멘탈 포함이 핵심
- Phase 1 후보가 Phase 2로 전환될 때 펀더멘탈 등급이 없어 교차 검증 불가 상태

**현재 파이프라인 제약**
- `getPhase2Symbols()`가 Phase 2 종목만 쿼리 → Phase 1 후보 스코어 없음
- `MAX_SYMBOLS_PER_QUERY = 500` 제한 있으나 루프로 배치 처리 중 (Phase 2가 ~1,144개)
- 파일 캐시가 `data/fundamental-cache/` 디렉토리에 저장되나 현재 실물 디렉토리조차 없음 (미생성 상태)

---

## 골 정렬

**ALIGNED** — Phase 2 상승 초입 주도주 포착의 직접적 전제 조건.

- Phase 1 → Phase 2 전환 시 펀더멘탈 등급이 있어야 "기술적 + 실적 교집합" 필터 적용 가능
- #58 검증에서 교집합이 가장 강력한 필터임을 확인했음에도, 현재 초입 포착 도구가 펀더멘탈 등급을 실시간으로 조회할 수 없는 구조
- 파일 캐시 휘발 문제로 인해 주간 리포트 외 다른 컨텍스트(일간, QA 등)에서는 펀더멘탈 등급 활용 불가

---

## 문제

`runFundamentalValidation()`이 Phase 2 종목만 스코어링하고 파일 캐시에만 저장해서,
Phase 1 후보 종목의 펀더멘탈 등급을 알 수 없고 세션 간 이력 추적이 불가능하다.

---

## Before → After

**Before**
- 스코어링 대상: `stock_phases WHERE phase = 2` 최신일 기준 (~1,144개)
- 저장 위치: `data/fundamental-cache/{date}.json` (파일, 휘발)
- 소비: 주간 에이전트의 `fundamentalSupplement` 문자열 생성에만 사용
- Phase 1 후보 종목: 펀더멘탈 등급 없음
- 재계산 빈도: 매주 실행 (분기 실적 기반인데 매번 재계산)

**After**
- 스코어링 대상: `symbols` 테이블 전체 활성 종목 (DB에 분기 데이터 있는 종목)
- 저장 위치: `fundamental_scores` DB 테이블 (`symbol + scored_date` 복합 유니크)
- 소비: DB 쿼리로 임의 시점 등급 조회 가능 (Phase 1 도구, 일간 에이전트 등)
- Phase 1 후보 종목: `fundamental_scores`에서 등급 바로 조회 가능
- 재계산 빈도: 분기 실적 변경 감지 기반 (또는 주 1회 유지하되 DB 중복 저장 방지)

---

## 변경 사항

### 1. DB 스키마 — `fundamental_scores` 테이블 신설

**파일**: `src/db/schema/analyst.ts`

```typescript
export const fundamentalScores = pgTable(
  "fundamental_scores",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    scoredDate: text("scored_date").notNull(), // YYYY-MM-DD (stock_phases 최신일)

    // 등급
    grade: text("grade").notNull(), // 'S' | 'A' | 'B' | 'C' | 'F'
    totalScore: integer("total_score").notNull(),
    rankScore: numeric("rank_score").notNull(),
    requiredMet: smallint("required_met").notNull(), // 0~2
    bonusMet: smallint("bonus_met").notNull(),       // 0~2

    // SEPA 기준별 판정 (JSON)
    criteria: text("criteria").notNull(), // JSON: SEPACriteria

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_fundamental_scores_symbol_date").on(t.symbol, t.scoredDate),
    idx_date: index("idx_fundamental_scores_date").on(t.scoredDate),
    idx_grade_date: index("idx_fundamental_scores_grade_date").on(t.grade, t.scoredDate),
  }),
);
```

설계 근거:
- `scoredDate`는 `stock_phases`의 `MAX(date)` 사용 — 데이터 기준일 일치
- `criteria`는 JSON 직렬화 — 컬럼 폭발 방지, 조회는 등급/score로 충분
- `symbol + scored_date` 복합 유니크 — 같은 날 중복 저장 방지 (재실행 안전)
- `grade` 인덱스 — "오늘 S/A 등급 전체 조회" 패턴에 최적화

### 2. Drizzle 마이그레이션

**파일**: `db/migrations/` (자동 생성)

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

### 3. `fundamental-data-loader.ts` — 전체 종목 로드 지원

**파일**: `src/lib/fundamental-data-loader.ts`

변경:
- `MAX_SYMBOLS_PER_QUERY = 500` 제한을 내부 배치 처리로 흡수 (현재는 호출자가 직접 배치)
- 또는 제한 유지하고 `runFundamentalValidation`에서 배치 처리 (현행 방식 유지 — 변경 최소화 선택)

결정: 현행 배치 처리 방식 유지. `loadFundamentalData`는 변경 없음.

### 4. `runFundamentalValidation.ts` — 핵심 변경

**파일**: `src/agent/fundamental/runFundamentalValidation.ts`

변경 목록:

#### 4-1. `getPhase2Symbols()` → `getAllScoringSymbols()` 교체

```typescript
// Before
async function getPhase2Symbols(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT symbol FROM stock_phases
    WHERE phase = 2 AND date = (SELECT MAX(date) FROM stock_phases)
    ORDER BY symbol
  `);
  ...
}

// After
async function getAllScoringSymbols(): Promise<string[]> {
  // quarterly_financials에 데이터가 있는 종목만 — 없으면 어차피 F등급
  const rows = await db.execute(sql`
    SELECT DISTINCT f.symbol
    FROM quarterly_financials f
    JOIN symbols s ON f.symbol = s.symbol
    WHERE s.is_actively_trading = true
    ORDER BY f.symbol
  `);
  ...
}
```

예상 종목 수: Phase 2 ~1,144개 → 전체 ~5,000~8,000개 (분기 데이터 있는 종목)
배치 처리(500개씩)는 현행 유지 — 이미 구현됨.

#### 4-2. 파일 캐시 제거

제거 대상:
- `CACHE_DIR` 상수
- `getCachePath()`, `loadCacheAsync()`, `saveCache()` 함수
- `node:fs` import (`existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync`)
- `join` from `"node:path"`
- 옵션 `ignoreCache`

#### 4-3. DB 저장 함수 추가

```typescript
async function saveFundamentalScoresToDB(
  scores: FundamentalScore[],
  scoredDate: string,
): Promise<void> {
  // 500개씩 배치 upsert
  const UPSERT_BATCH = 500;
  for (let i = 0; i < scores.length; i += UPSERT_BATCH) {
    const batch = scores.slice(i, i + UPSERT_BATCH);
    await db.execute(sql`
      INSERT INTO fundamental_scores
        (symbol, scored_date, grade, total_score, rank_score, required_met, bonus_met, criteria)
      VALUES
        ${sql.join(batch.map(s => sql`(
          ${s.symbol}, ${scoredDate}, ${s.grade},
          ${s.totalScore}, ${s.rankScore.toString()},
          ${s.requiredMet}, ${s.bonusMet},
          ${JSON.stringify(s.criteria)}
        )`), sql`, `)}
      ON CONFLICT (symbol, scored_date) DO UPDATE SET
        grade = EXCLUDED.grade,
        total_score = EXCLUDED.total_score,
        rank_score = EXCLUDED.rank_score,
        required_met = EXCLUDED.required_met,
        bonus_met = EXCLUDED.bonus_met,
        criteria = EXCLUDED.criteria
    `);
  }
}
```

#### 4-4. `ValidationResult` 타입 변경

```typescript
// Before
export interface ValidationResult {
  scores: FundamentalScore[];
  reportsPublished: string[];
  totalTokens: { input: number; output: number };
}

// After — 동일 유지 (소비처 호환성 보장)
// scores 필드는 당일 실행 결과를 메모리에서 반환 (주간 에이전트 즉시 사용용)
```

#### 4-5. `scoredDate` 결정 로직

`stock_phases MAX(date)` 사용 (기존 `getCacheDate()` 로직 재활용):
```typescript
async function getScoredDate(): Promise<string> {
  const rows = await db.execute(sql`SELECT MAX(date)::text AS max_date FROM stock_phases`);
  const row = (rows.rows as { max_date: string | null }[])[0];
  return row?.max_date ?? new Date().toISOString().slice(0, 10);
}
```

#### 4-6. 당일 재실행 중복 방지

```typescript
async function hasTodayScores(scoredDate: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM fundamental_scores
    WHERE scored_date = ${scoredDate}
  `);
  const cnt = (rows.rows as { cnt: number }[])[0]?.cnt ?? 0;
  return cnt > 0;
}
```

`ignoreCache` 옵션 대신 `forceRescore?: boolean` 옵션으로 동일 역할 유지.

### 5. DB 조회 헬퍼 추가 (신규)

**파일**: `src/lib/fundamental-db.ts` (신규)

초입 포착 도구와 기타 소비처가 편리하게 등급을 조회할 수 있는 헬퍼:

```typescript
/**
 * 특정 날짜 기준 종목들의 펀더멘탈 등급 조회.
 * 초입 포착 도구(getPhase1LateStocks 등)에서 교집합 필터에 사용.
 */
export async function getFundamentalGrades(
  symbols: string[],
  scoredDate?: string, // 미지정 시 최신 scored_date 사용
): Promise<Map<string, FundamentalGrade>> { ... }

/**
 * 최신 날짜 기준 S/A 등급 종목 전체 조회.
 * 주간 에이전트 fundamentalSupplement 생성에 사용.
 */
export async function getTopGradeScores(
  minGrade: FundamentalGrade = "B",
  scoredDate?: string,
): Promise<FundamentalScore[]> { ... }
```

### 6. 기존 소비처 영향 분석

| 소비처 | 현재 방식 | 변경 후 | 영향 |
|--------|-----------|---------|------|
| `run-weekly-agent.ts` | `runFundamentalValidation()` 호출 → `validationResult.scores` | 동일 API 유지 (메모리 반환) | **없음** |
| `formatFundamentalSupplement()` | `scores[]` 인자 | 동일 | **없음** |
| `buildWeeklySystemPrompt()` | `fundamentalSupplement` 문자열 | 동일 | **없음** |
| `getPhase1LateStocks.ts` | 펀더멘탈 정보 없음 | `getFundamentalGrades()` 추가 사용 가능 | 선택적 개선 (이번 스코프 외) |
| `getRisingRS.ts` | 펀더멘탈 정보 없음 | 동일 | 선택적 개선 (이번 스코프 외) |

**중요**: `ValidationResult` 인터페이스와 `runFundamentalValidation()` 시그니처를 유지하므로 `run-weekly-agent.ts` 변경 불필요.

### 7. 파일 캐시 디렉토리 정리

- `data/fundamental-cache/` — 코드 제거와 함께 `.gitignore`에서도 제거
- 현재 물리적으로 존재하지 않으므로 삭제 작업 불필요

---

## 작업 계획

### Step 1 — DB 스키마 + 마이그레이션 [실행국/구현]
완료 기준:
- `src/db/schema/analyst.ts`에 `fundamentalScores` 테이블 추가
- `npx drizzle-kit generate` + `npx drizzle-kit migrate` 실행
- `src/db/schema/index.ts` 재export 추가

### Step 2 — `runFundamentalValidation.ts` 리팩터 [실행국/구현]
완료 기준:
- `getPhase2Symbols()` → `getAllScoringSymbols()` 교체
- 파일 캐시 코드(함수 4개 + 상수 + import) 전량 제거
- `saveFundamentalScoresToDB()` 구현 + 파이프라인에 삽입
- `getScoredDate()` + `hasTodayScores()` 구현
- `ignoreCache` 옵션 → `forceRescore` 로 rename
- `ValidationResult` 인터페이스 호환성 유지

### Step 3 — `fundamental-db.ts` 헬퍼 [실행국/구현]
완료 기준:
- `getFundamentalGrades(symbols, scoredDate?)` 구현
- `getTopGradeScores(minGrade, scoredDate?)` 구현
- 타입 export 정비

### Step 4 — 테스트 [검증국/QA]
완료 기준:
- `fundamental-scorer.ts` 기존 유닛 테스트 통과 (변경 없음)
- `runFundamentalValidation` 통합 테스트: DB 저장 검증 (mock DB)
- `fundamental-db.ts` 헬퍼 유닛 테스트
- `symbols?: string[]` 옵션으로 소규모 테스트 실행 가능 확인

### Step 5 — 코드 리뷰 + PR [pr-manager]
완료 기준:
- `code-reviewer` 에이전트 CRITICAL/HIGH 이슈 없음
- PR 생성 및 머지

---

## 리스크

### R1: 전체 종목 스코어링 시간 증가
- 현재 Phase 2 ~1,144개 → 전체 ~5,000~8,000개 예상
- 스코어링 자체는 순수 연산 (LLM 없음) — CPU 바운드
- DB 로드가 병목: 배치 500개 × 16회 쿼리 예상
- 완화: 배치 크기 조정 가능. 주간 실행이므로 10분 이내면 허용 가능.

### R2: `scored_date` 기준 불일치
- `stock_phases MAX(date)`와 `quarterly_financials`의 데이터 기준일이 다름
- 완화: `scored_date`는 "스코어링 실행 기준일"로 의미를 명확히 — 펀더멘탈 데이터 자체의 날짜가 아님. `criteria` JSON에 `periodEndDate`가 포함되므로 실제 실적 기준일은 추적 가능.

### R3: `upsert` 시 S등급 변동
- 같은 `scored_date`에 재실행하면 `promoteTopToS()`의 전체 종목 집합 기준이 달라질 수 있음 (예: `symbols?` 옵션으로 부분 실행 시)
- 완화: `symbols` 옵션 지정 시 DB 저장 스킵 (현행 캐시와 동일한 정책)

### R4: `getAllScoringSymbols()` 반환 종목 수 불확실
- `quarterly_financials`에 데이터가 있는 종목 수 미확인
- 완화: 구현 전 쿼리로 실제 수 확인 필요

---

## 의사결정 필요

### D1: 초입 포착 도구(getPhase1LateStocks 등)에서 펀더멘탈 등급 교차 필터를 이번 스코프에 포함할지 여부
- **포함 시**: Step 3 이후 Step 3.5 추가 — `getPhase1LateStocks` 내 `getFundamentalGrades()` 호출 + 결과에 `fundamentalGrade` 필드 추가
- **미포함 시**: 이번은 인프라(DB 저장)만 구축, 교집합 필터는 후속 이슈로 분리
- 판단: 미션 플래너 자율 판단 — **미포함 권고**. 인프라 구축을 먼저 완료하고 검증 후 교집합 필터를 별도 PR로 분리하는 것이 리스크 낮음.

### D2: `getAllScoringSymbols()` 쿼리 기준
- 옵션 A: `quarterly_financials`에 데이터 있는 종목 (활성 여부 무관)
- 옵션 B: `symbols.is_actively_trading = true` AND `quarterly_financials` 데이터 있는 종목
- 판단: **옵션 B 권고**. 비활성 종목 스코어링은 낭비.
