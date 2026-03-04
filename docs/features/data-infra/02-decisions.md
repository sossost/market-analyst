# Decisions: Data Infrastructure

**Created:** 2026-03-04
**Updated:** 2026-03-04

---

## Technical Decisions

### 1. 계산 주체: ETL(사전 계산) vs Agent(실시간 계산)

| Option | Pros | Cons |
|--------|------|------|
| A: ETL 사전 계산 | 정확하고 일관된 계산, Agent 토큰 절약, 빠른 조회 | 새 지표 추가 시 ETL 수정 필요 |
| B: Agent 실시간 계산 | 유연함, ETL 불필요 | LLM 계산 실수 가능, 토큰 낭비, 느림 |
| C: 하이브리드 | 핵심은 ETL, 탐색적은 Agent | 경계 설정 필요 |

**Chosen:** A: ETL 사전 계산
**Reason:** LLM은 숫자 계산에 약하고 해석에 강함. 섹터 RS, Phase 판별, 브레드스는 확정적 계산이므로 ETL이 담당. Agent는 결과 조회 + 해석에 집중.

---

### 2. Phase 판별 프레임워크: Weinstein vs Minervini vs 커스텀

| Option | Pros | Cons |
|--------|------|------|
| A: Weinstein Stage Analysis | 체계적, 검증된 프레임워크, MA150(30주) 중심 | Phase 경계가 다소 모호할 수 있음 |
| B: Minervini SEPA | 더 엄격한 필터, 고성능 종목 집중 | 조건이 너무 엄격해 후보가 적을 수 있음 |
| C: 커스텀 로직 | 완전한 자유 | 검증 안 된 로직, 유지보수 어려움 |

**Chosen:** A: Weinstein Stage Analysis
**Reason:** 가장 체계적이고 Phase 1→2 전환 포착에 최적화된 프레임워크. MA150(≈30주 이동평균) 기준으로 Phase를 명확히 구분 가능. Minervini SEPA 조건은 Phase 2 내에서 추가 필터로 활용 가능.

---

### 3. 그룹 분류 체계: 2단계(Sector → Industry) 도입

| Option | Pros | Cons |
|--------|------|------|
| A: Sector(11개 대분류)만 | 기존 DB에 있음, 단순 | "광통신" 같은 소분류를 찾을 수 없음 |
| B: Sector + Industry 2단계 | 대분류로 흐름 보고, 소분류로 드릴다운 | 테이블 1개 추가, Industry 종목 수 적을 수 있음 |
| C: GICS 4단계 분류 | 가장 세밀 | 매핑 복잡, 필요 이상으로 세분화 |

**Chosen:** B: Sector + Industry 2단계
**Reason:** 주도주를 찾으려면 소분류(Industry)가 필수. "Technology" → "Optical Communication"으로 드릴다운해야 광통신 주도주를 찾을 수 있음. FMP symbols.industry 필드를 그대로 활용.

---

### 4. 섹터/Industry 자체 Phase 판별

| Option | Pros | Cons |
|--------|------|------|
| A: 섹터/Industry도 Phase 판별 | 그룹 레벨에서 Phase 1→2 전환 감지 가능 | 개별 종목 Phase와 혼동 가능 |
| B: 종목 Phase만 | 단순 | 섹터 레벨 전환 시그널 누락 |

**Chosen:** A: 섹터/Industry도 Phase 판별
**Reason:** 2024년 AI 소프트웨어 "섹터 자체"가 Phase 2로 전환한 것이 PLTR 상승의 배경. 그룹 레벨 Phase가 있어야 Agent가 "이 Industry가 새로 Phase 2 진입했다"를 판단 가능.

---

### 5. Phase 전환 급증 감지

| Option | Pros | Cons |
|--------|------|------|
| A: 5일 윈도우 집계 | 단기 급증 포착, 노이즈 적절히 필터 | 느린 전환은 놓칠 수 있음 |
| B: 단일 일 집계 | 가장 빠른 감지 | 노이즈에 취약 |
| C: 10일 윈도우 | 안정적이지만 느림 | 시그널이 이미 늦을 수 있음 |

**Chosen:** A: 5일 윈도우 집계
**Reason:** Phase 전환은 하루에 몇 종목씩 점진적으로 발생. 5일 윈도우가 의미 있는 클러스터링 단위. Agent가 추가로 10일/20일 추세를 자체 분석할 수 있으므로 ETL은 5일로 충분.

---

### 6. 펀더멘털 가속 집계 포함 여부

| Option | Pros | Cons |
|--------|------|------|
| A: 섹터/Industry RS 테이블에 포함 | 한 테이블에서 기술+펀더멘털 종합 조회 | 테이블 컬럼 증가 |
| B: 별도 테이블 분리 | 정규화, 깔끔 | JOIN 필요, 조회 복잡 |

**Chosen:** A: 같은 테이블에 포함
**Reason:** Agent가 "RS 가속 + 펀더멘털 뒷받침" 을 한 쿼리로 확인할 수 있어야 함. 컬럼 수가 많아지지만, 실제 사용 패턴상 항상 함께 조회되므로 합리적.

---

### 7. DB 테이블 위치

| Option | Pros | Cons |
|--------|------|------|
| A: 같은 Supabase, 신규 테이블 | 기존 테이블 JOIN 가능, 인프라 비용 없음 | DB 결합도 증가 |
| B: 별도 DB 인스턴스 | 완전 분리, 장애 격리 | 기존 데이터 접근 불가 (복제 필요), 비용 증가 |

**Chosen:** A: 같은 Supabase, 신규 테이블
**Reason:** 섹터 RS 계산에 기존 daily_prices, symbols 테이블 JOIN이 필수. 별도 DB면 데이터 복제 필요. 신규 테이블은 prefix나 별도 schema로 구분 가능.

---

### 8. MA150 기울기 계산 방법

| Option | Pros | Cons |
|--------|------|------|
| A: 단순 변화율 | 구현 간단, 직관적 | 노이즈에 민감할 수 있음 |
| B: 선형회귀 기울기 | 통계적으로 더 견고 | 구현 복잡도 증가 |

**Chosen:** A: 단순 변화율
**Reason:** 초기 구현은 단순하게 시작. Phase 판별의 핵심은 "MA150이 올라가고 있는가"이므로 단순 변화율로 충분. 필요 시 선형회귀로 업그레이드.

---

## Architecture Decisions (from /plan)

### 9. 프로젝트 기술 스택

| Option | Pros | Cons |
|--------|------|------|
| A: screener와 동일 스택 (Drizzle + tsx + dotenv) | 패턴 재활용, 학습 비용 0 | 독립성 낮아질 수 있음 |
| B: 다른 ORM/런타임 | 최신 도구 활용 | 불필요한 차이, 유지보수 부담 |

**Chosen:** A: screener와 동일 스택
**Reason:** DB를 공유하므로 ORM이 같아야 스키마 정의가 일관됨. ETL 패턴(retry, batch, validation)도 검증됨. 새로 만들 이유 없음.

---

### 10. 읽기 전용 스키마 정의 방식

| Option | Pros | Cons |
|--------|------|------|
| A: screener 테이블 스키마를 market-analyst에서 재정의 (읽기 전용 표시) | 타입 안전한 쿼리, Drizzle 자동완성 | 스키마 동기화 수동 관리 |
| B: Raw SQL로 기존 테이블 쿼리 | 스키마 정의 불필요 | 타입 안전성 없음, 실수 위험 |

**Chosen:** A: 읽기 전용 스키마 재정의
**Reason:** Phase 판별에서 daily_prices, daily_ma, symbols를 빈번히 조회. 타입 안전성이 필수. screener 스키마가 안정적이므로 동기화 부담 적음.

---

### 11. Phase 판별 로직 구조

| Option | Pros | Cons |
|--------|------|------|
| A: 순수 함수로 분리 (DB 의존 없음) | 유닛 테스트 용이, 재사용 가능 | DB 조회와 판별 로직 분리 필요 |
| B: ETL 스크립트에 인라인 | 구현 빠름 | 테스트 어려움, 재사용 불가 |

**Chosen:** A: 순수 함수로 분리
**Reason:** Phase 판별은 핵심 비즈니스 로직. 입력(가격, MA, RS, 52주 H/L)을 받아 Phase를 반환하는 순수 함수로 만들어야 테스트 가능. TDD로 구현.

---

### 12. Group RS 계산 로직 재사용

| Option | Pros | Cons |
|--------|------|------|
| A: 공통 함수 + sector/industry 파라미터화 | 코드 중복 제거, 일관성 보장 | 추상화 설계 필요 |
| B: sector-rs, industry-rs 각각 독립 구현 | 단순, 독립 수정 가능 | 동일 로직 중복 |

**Chosen:** A: 공통 함수 파라미터화
**Reason:** sector_rs_daily와 industry_rs_daily는 그룹핑 키(sector vs industry)와 최소 종목 수(10 vs 5)만 다를 뿐 로직이 동일. 공통 `buildGroupRs(groupBy, minStockCount)` 함수로 추출.

---

## Architecture

### Structure

```
market-analyst/
├── src/
│   ├── db/
│   │   ├── client.ts                # DB 커넥션 (screener와 동일 패턴)
│   │   ├── schema/
│   │   │   ├── readonly.ts          # screener 테이블 (읽기 전용 참조)
│   │   │   └── analyst.ts           # 신규 테이블 (sector_rs, industry_rs, stock_phases)
│   │   └── migrate.ts               # 마이그레이션 실행기
│   ├── etl/
│   │   ├── jobs/
│   │   │   ├── build-stock-phases.ts
│   │   │   ├── build-sector-rs.ts
│   │   │   └── build-industry-rs.ts
│   │   └── utils/
│   │       ├── retry.ts             # screener 패턴 재사용
│   │       ├── common.ts            # sleep, toNum 등
│   │       ├── validation.ts        # 환경변수 검증
│   │       └── date-helpers.ts      # 거래일 조회
│   ├── lib/
│   │   ├── phase-detection.ts       # 순수 함수: Phase 1/2/3/4 판별
│   │   ├── group-rs.ts              # 공통 함수: 섹터/Industry RS 계산
│   │   └── group-phase.ts           # 공통 함수: 섹터/Industry Phase 판별
│   └── types/
│       └── index.ts                 # 공유 타입 정의
├── db/
│   └── migrations/                  # Drizzle 마이그레이션 파일
├── __tests__/
│   ├── lib/
│   │   ├── phase-detection.test.ts  # Phase 판별 유닛 테스트
│   │   ├── group-rs.test.ts         # Group RS 유닛 테스트
│   │   └── group-phase.test.ts      # Group Phase 유닛 테스트
│   └── etl/
│       └── integration.test.ts      # ETL 통합 테스트 (테스트 DB)
├── .github/
│   └── workflows/
│       └── etl-daily.yml            # 스케줄링
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── .env.example
```

### Core Flow (Pseudo-code)

```
=== build-stock-phases.ts ===

main():
  1. validateEnvironment(DATABASE_URL)
  2. targetDate = getLatestTradeDate() from screener DB
  3. allSymbols = SELECT symbol, sector, industry FROM symbols
                  WHERE isActivelyTrading = true AND isEtf = false

  4. For each batch of 200 symbols:
     a. Fetch from screener DB:
        - daily_prices: close, rs_score (today + 252 trading days for 52w H/L)
        - daily_ma: ma20, ma50, ma100, ma200 (today + 20 days ago for slope)

     b. For each symbol in batch:
        input = {
          price: today.close,
          ma50, ma150 (= ma100 proxy or calculated), ma200,
          ma150_20d_ago,
          rsScore,
          high52w, low52w
        }
        phase = detectPhase(input)  // Pure function

     c. Fetch prevPhase from stock_phases (yesterday)
     d. Detect transitions (prevPhase → phase)

     e. Batch upsert to stock_phases

=== detectPhase(input) → { phase, detail } ===  (Pure Function)

  ma150Slope = (ma150_today - ma150_20d_ago) / ma150_20d_ago

  if isPhase2(input, ma150Slope):
    return { phase: 2, detail: { ...conditions_met } }
  if isPhase4(input, ma150Slope):
    return { phase: 4, detail: { ... } }
  if isPhase1(input, ma150Slope):
    return { phase: 1, detail: { ... } }
  return { phase: 3, detail: { ... } }  // Default

=== build-sector-rs.ts / build-industry-rs.ts ===

main():
  1. validateEnvironment(DATABASE_URL)
  2. targetDate = getLatestTradeDate()
  3. buildGroupRs({
       groupBy: 'sector',  // or 'industry'
       minStockCount: 10,  // or 5
       targetDate,
       outputTable: sectorRsDaily,  // or industryRsDaily
     })

=== buildGroupRs(config) ===  (Shared Function)

  // Step 1: RS 평균 + 랭킹
  groups = SQL:
    SELECT sector/industry, AVG(rs_score), COUNT(*)
    FROM symbols JOIN daily_prices ON today
    GROUP BY sector/industry
    HAVING COUNT(*) >= minStockCount

  // Step 2: 가속도 (4w/8w/12w 변화)
  For each group:
    prev4w = SELECT avg_rs FROM output_table WHERE date = targetDate - 20 trading days
    change_4w = current_avg_rs - prev4w
    (same for 8w, 12w)

  // Step 3: 브레드스
  For each group:
    breadth = SQL:
      SELECT
        COUNT(CASE WHEN ma50>ma150 AND ma150>ma200 THEN 1 END) / COUNT(*) as ma_ordered_ratio,
        COUNT(CASE WHEN sp.phase = 2 THEN 1 END) / COUNT(*) as phase2_ratio,
        COUNT(CASE WHEN dp.rs_score > 50 THEN 1 END) / COUNT(*) as rs_above50_ratio,
        COUNT(CASE WHEN dp.close >= MAX(dp.close) OVER 20d THEN 1 END) / COUNT(*) as new_high_ratio
      FROM symbols s
      JOIN daily_prices dp ON s.symbol = dp.symbol
      JOIN daily_ma dm ON s.symbol = dm.symbol
      JOIN stock_phases sp ON s.symbol = sp.symbol
      WHERE s.sector/industry = group AND dp.date = targetDate

  // Step 4: Phase 전환 급증
  For each group:
    transitions = SQL:
      SELECT COUNT(*) FROM stock_phases
      WHERE symbol IN (group_symbols)
        AND date BETWEEN targetDate-5d AND targetDate
        AND prev_phase = 1 AND phase = 2

  // Step 5: 펀더멘털 가속
  For each group:
    fundamentals = SQL:
      SELECT
        COUNT(CASE WHEN rev_growth_2q THEN 1 END) / COUNT(*) as revenue_accel_ratio,
        COUNT(CASE WHEN inc_growth_2q THEN 1 END) / COUNT(*) as income_accel_ratio,
        COUNT(CASE WHEN eps > 0 THEN 1 END) / COUNT(*) as profitable_ratio
      FROM quarterly_financials
      WHERE symbol IN (group_symbols) AND latest 2 quarters

  // Step 6: 그룹 Phase 판별
  For each group:
    groupPhase = detectGroupPhase(change_4w, change_8w, phase2_ratio)

  // Step 7: Upsert all
  upsert to output_table
```

### Key Interfaces

```typescript
// Phase Detection Input
interface PhaseInput {
  price: number
  ma50: number
  ma150: number
  ma200: number
  ma150_20dAgo: number
  rsScore: number
  high52w: number
  low52w: number
}

// Phase Detection Output
interface PhaseResult {
  phase: 1 | 2 | 3 | 4
  ma150Slope: number
  detail: PhaseDetail
}

interface PhaseDetail {
  price: number
  ma50: number
  ma150: number
  ma200: number
  ma150Slope: number
  rsScore: number
  high52w: number
  low52w: number
  pctFromLow: number
  pctFromHigh: number
  conditionsMet: string[]
}

// Group RS Config
interface GroupRsConfig {
  groupBy: 'sector' | 'industry'
  minStockCount: number
  targetDate: string
}

// Group RS Row (output to sector_rs_daily / industry_rs_daily)
interface GroupRsRow {
  date: string
  groupName: string       // sector or industry name
  parentGroup?: string    // sector (for industry only)

  avgRs: number
  rsRank: number
  stockCount: number
  change4w: number | null
  change8w: number | null
  change12w: number | null

  groupPhase: 1 | 2 | 3 | 4
  prevGroupPhase: number | null

  maOrderedRatio: number
  phase2Ratio: number
  rsAbove50Ratio: number
  newHighRatio: number

  phase1to2_5dCount: number
  phase2to3_5dCount: number

  revenueAccelRatio: number
  incomeAccelRatio: number
  profitableRatio: number
}
```

### MA150 계산 참고

screener DB의 daily_ma에는 ma20, ma50, ma100, ma200만 있고 **ma150이 없다.**

두 가지 접근:
1. **ma100과 ma200의 중간값 근사**: `ma150 ≈ (ma100 + ma200) / 2` — 부정확
2. **직접 계산**: daily_prices에서 최근 150일 close 평균 — 정확하지만 추가 쿼리

**선택: 직접 계산.** build-stock-phases에서 각 종목의 최근 150일 + 170일(20일 전 MA150) close를 조회하여 직접 AVG 계산. Phase 판별의 정확도가 핵심이므로 근사하지 않는다.
