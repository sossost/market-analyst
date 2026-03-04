# Feature Spec: Data Infrastructure

**Status:** Draft
**Created:** 2026-03-04
**Updated:** 2026-03-04
**Author:** brainstorm session
**Feature:** F1 — analyst-data-infra

---

## Overview

Agent가 주도섹터/주도주를 판별하기 위한 **데이터 기반을 구축**하는 피처.
**섹터(대분류) + Industry(소분류)** 2단계 RS 엔진, Weinstein Phase 판별, 브레드스, 펀더멘털 가속 집계를 ETL 파이프라인으로 매일 자동 실행.

Agent는 숫자 계산에 약하고 해석에 강하다. 따라서 **확정적인 계산은 ETL이 하고, Agent는 결과를 조회만** 한다.

### 왜 2단계(Sector → Industry)가 필요한가

"광통신"은 Technology **섹터** 안의 하위 **Industry**다.
Technology 섹터 RS가 올라도, 그 안에서 Software는 둔화하고 Optical Communication만 급등할 수 있다.
**주도 Industry를 찾지 못하면 주도주를 찾을 수 없다.**

```
Sector: Technology (RS +5)
  └── Industry: Optical Communication (RS +25) ← 진짜 주도
  └── Industry: Software (RS -3)              ← 둔화
  └── Industry: Semiconductors (RS +8)        ← 보통
```

---

## User Goals

- Agent가 "어떤 **섹터**가 가속하고 있나?"를 즉시 조회할 수 있다
- Agent가 "그 섹터 안에서 어떤 **Industry**가 끌고 있나?"를 드릴다운할 수 있다
- Agent가 "이 종목이 Phase 몇인가?"를 즉시 판별할 수 있다
- Agent가 "이 Industry에서 몇 %의 종목이 동반 상승 중인가?"를 확인할 수 있다
- Agent가 "이 Industry에서 Phase 1→2 전환이 급증하고 있나?"를 감지할 수 있다
- Agent가 "이 섹터/Industry에서 매출 가속 종목이 얼마나 되나?"를 확인할 수 있다
- 모든 데이터는 매일 장 마감 후 자동으로 계산되어 DB에 저장된다

---

## Behavior

### 1. 섹터 RS 엔진 (대분류)

**목적:** 시장 대비 어떤 섹터가 강한지, 그 강세가 **가속**하고 있는지 파악.

#### 계산 방식

```
섹터별 평균 RS = 해당 섹터 소속 종목들의 RS 점수 평균
  - screener DB의 symbols.sector 기준으로 종목 그룹핑
  - daily_prices.rs_score 기준

섹터 RS 변화율 (가속도):
  - 4주 변화: (현재 섹터RS - 4주 전 섹터RS)
  - 8주 변화: (현재 섹터RS - 8주 전 섹터RS)
  - 12주 변화: (현재 섹터RS - 12주 전 섹터RS)

섹터 RS 랭킹:
  - 전체 섹터를 RS 점수 기준 내림차순 랭킹
  - 가속도(4주 변화) 기준 별도 랭킹
```

#### 대상 섹터

screener DB의 `symbols.sector` 고유값 기준. 주요 섹터:
- Technology, Healthcare, Financial Services, Consumer Cyclical,
  Industrials, Communication Services, Consumer Defensive,
  Energy, Basic Materials, Real Estate, Utilities

#### 최소 종목 수

섹터 내 종목 수 < 10인 경우 섹터 RS 계산에서 제외 (통계적 의미 없음).

#### 섹터 자체 Phase 판별

섹터도 Phase를 가진다. 섹터 평균 RS의 추세로 판별:
- **Phase 2 섹터:** 섹터 RS 상승 추세 + 4주 변화 양수 + 브레드스 확장
- **Phase 1→2 전환 섹터:** 섹터 RS가 횡보에서 상승으로 전환

```
sector_phase 판별 기준:
  Phase 2: change_4w > 0 AND change_8w > 0 AND phase2_ratio > 30%
  Phase 1: |change_4w| < 2 AND |change_8w| < 3
  Phase 4: change_4w < 0 AND change_8w < 0
  Phase 3: 나머지
```

---

### 2. Industry RS 엔진 (소분류)

**목적:** 섹터 내에서 **어떤 Industry가 주도하고 있는지** 식별. 이것이 "광통신", "HBM", "AI 소프트웨어"를 찾는 핵심.

#### 계산 방식

섹터 RS 엔진과 동일한 구조, `symbols.industry` 기준으로 그룹핑.

```
Industry별 평균 RS = 해당 Industry 소속 종목들의 RS 점수 평균
  - screener DB의 symbols.industry 기준

Industry RS 변화율 (가속도):
  - 4주/8주/12주 변화

Industry RS 랭킹:
  - 전체 Industry 중 RS 점수 기준 내림차순
  - 가속도 기준 별도 랭킹

Industry 브레드스:
  - MA정배열 비율, Phase 2 비율, RS>50 비율, 신고가 비율
  - (섹터 브레드스와 동일한 4개 지표)
```

#### 최소 종목 수

Industry 내 종목 수 < 5인 경우 계산에서 제외.

#### Industry 자체 Phase 판별

섹터 Phase와 동일한 로직, Industry 단위 적용.

---

### 3. Weinstein Phase 판별 (종목 단위)

**목적:** 개별 종목이 현재 Phase 1/2/3/4 중 어디에 있는지 자동 판별.

#### Phase 정의

| Phase | 이름 | 조건 |
|-------|------|------|
| Phase 1 | 베이스/축적 | MA150 횡보 (기울기 ≈ 0), 가격이 MA150 근처에서 등락 |
| Phase 2 | 상승/마크업 | 가격 > 상승하는 MA150, RS 상승 추세, HH/HL 패턴 |
| Phase 3 | 천장/분배 | MA150 기울기 둔화, 가격이 MA150 근처로 수렴, RS 둔화 |
| Phase 4 | 하락/마크다운 | 가격 < 하락하는 MA150, RS 하락 추세 |

#### 상세 판별 로직

**Phase 2 조건 (모두 충족):**
1. 현재가 > MA150
2. 현재가 > MA200
3. MA150 > MA200
4. MA150 기울기 > 0 (최근 20일 기준 상승)
5. MA50 > MA150 > MA200
6. 현재가 > 52주 최저가 × 1.25 (최저점 대비 25% 이상)
7. 현재가 > 52주 최고가 × 0.75 (최고점 대비 25% 이내)
8. RS 점수 > 50 (시장 평균 이상)

**Phase 1 조건:**
1. MA150 기울기 ≈ 0 (절대값 < 임계치)
2. 가격이 MA150 ± 10% 범위 내
3. Phase 2 조건 미충족

**Phase 4 조건:**
1. 현재가 < MA150
2. MA150 기울기 < 0
3. RS 점수 < 50

**Phase 3 조건:**
1. Phase 2, 4 모두 아닌 경우
2. MA150 기울기가 양수에서 0에 근접
3. 또는 가격이 MA150 아래로 내려오기 시작

#### Phase 전환 감지

- 전일 Phase와 금일 Phase 비교
- Phase 1→2 전환: **가장 중요한 시그널** (주도주 초입)
- Phase 2→3 전환: 주의 시그널 (이탈 검토)
- 전환 이력을 별도 컬럼에 기록 (transition_from, transition_date)

---

### 4. 섹터/Industry 브레드스 (Breadth)

**목적:** 섹터/Industry 내 종목들이 **동반으로** 상승하고 있는지 확인. 주도섹터의 특징은 한두 종목이 아니라 다수가 함께 오르는 것.

#### 계산 지표 (섹터, Industry 모두 동일 적용)

| 지표 | 계산 방식 |
|------|-----------|
| MA정배열 비율 | (MA50 > MA150 > MA200) 종목 수 / 전체 종목 수 |
| Phase 2 비율 | Phase 2 종목 수 / 전체 종목 수 |
| RS 50 이상 비율 | RS > 50 종목 수 / 전체 종목 수 |
| 신고가 비율 | 20일 신고가 종목 수 / 전체 종목 수 |

#### 주도섹터/Industry 시그널 기준 (참고용, Agent가 최종 판단)

- MA정배열 비율 > 60%
- Phase 2 비율 > 40%
- RS 50 이상 비율 > 60%
- RS 4주 변화 > +5

---

### 5. Phase 전환 급증 감지

**목적:** 한 Industry에서 **동시다발적으로** Phase 1→2 전환이 발생하면, 해당 Industry가 새로운 주도 그룹으로 부상하는 강력한 시그널.

#### 계산 방식

```
Industry별 Phase 전환 집계 (오늘 기준):
  - phase1_to_2_count: Phase 1→2 전환 종목 수 (최근 5일)
  - phase1_to_2_ratio: 전환 종목 수 / Industry 전체 종목 수
  - phase2_to_3_count: Phase 2→3 전환 종목 수 (최근 5일) — 경고용

급증 기준 (참고용):
  - 5일 내 Phase 1→2 전환이 3종목 이상 또는 비율 20% 이상
```

sector_rs_daily와 industry_rs_daily에 전환 카운트 컬럼으로 포함.

---

### 6. 펀더멘털 가속 집계

**목적:** 가격만이 아니라 **매출/이익 가속이 동반**되는 섹터/Industry 확인. 구조적 성장 vs 단순 투기 구별.

#### 계산 방식

```
섹터/Industry별 매출 가속 비율:
  - revenue_accel_ratio: 최근 2분기 연속 매출 성장 종목 수 / 전체
  - income_accel_ratio: 최근 2분기 연속 이익 성장 종목 수 / 전체
  - profitable_ratio: 최근 분기 EPS > 0 종목 수 / 전체

의존성: screener DB의 quarterly_financials 테이블
```

sector_rs_daily와 industry_rs_daily에 펀더멘털 컬럼으로 포함.

---

## Data Model

### sector_rs_daily

```sql
CREATE TABLE sector_rs_daily (
  id            SERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  sector        VARCHAR(100) NOT NULL,

  -- RS
  avg_rs            DECIMAL(8,2),       -- 섹터 평균 RS
  rs_rank           INTEGER,            -- 섹터 RS 순위
  stock_count       INTEGER,            -- 섹터 내 종목 수
  change_4w         DECIMAL(8,2),       -- 4주 RS 변화 (가속도)
  change_8w         DECIMAL(8,2),       -- 8주 RS 변화
  change_12w        DECIMAL(8,2),       -- 12주 RS 변화

  -- Phase (섹터 자체)
  sector_phase      SMALLINT,           -- 섹터 자체 Phase (1/2/3/4)
  prev_sector_phase SMALLINT,           -- 전일 섹터 Phase

  -- 브레드스
  ma_ordered_ratio  DECIMAL(5,2),       -- MA정배열 비율 (0-100)
  phase2_ratio      DECIMAL(5,2),       -- Phase 2 비율 (0-100)
  rs_above50_ratio  DECIMAL(5,2),       -- RS>50 비율 (0-100)
  new_high_ratio    DECIMAL(5,2),       -- 20일 신고가 비율 (0-100)

  -- Phase 전환 급증
  phase1to2_5d_count  INTEGER DEFAULT 0,  -- 최근 5일 Phase1→2 전환 수
  phase2to3_5d_count  INTEGER DEFAULT 0,  -- 최근 5일 Phase2→3 전환 수

  -- 펀더멘털
  revenue_accel_ratio  DECIMAL(5,2),    -- 매출 가속 종목 비율 (0-100)
  income_accel_ratio   DECIMAL(5,2),    -- 이익 가속 종목 비율 (0-100)
  profitable_ratio     DECIMAL(5,2),    -- 흑자 종목 비율 (0-100)

  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, sector)
);
```

### industry_rs_daily

```sql
CREATE TABLE industry_rs_daily (
  id            SERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  sector        VARCHAR(100) NOT NULL,  -- 상위 섹터 (드릴다운용)
  industry      VARCHAR(200) NOT NULL,

  -- RS
  avg_rs            DECIMAL(8,2),
  rs_rank           INTEGER,            -- 전체 Industry 중 순위
  stock_count       INTEGER,
  change_4w         DECIMAL(8,2),
  change_8w         DECIMAL(8,2),
  change_12w        DECIMAL(8,2),

  -- Phase (Industry 자체)
  industry_phase      SMALLINT,
  prev_industry_phase SMALLINT,

  -- 브레드스
  ma_ordered_ratio    DECIMAL(5,2),
  phase2_ratio        DECIMAL(5,2),
  rs_above50_ratio    DECIMAL(5,2),
  new_high_ratio      DECIMAL(5,2),

  -- Phase 전환 급증
  phase1to2_5d_count  INTEGER DEFAULT 0,
  phase2to3_5d_count  INTEGER DEFAULT 0,

  -- 펀더멘털
  revenue_accel_ratio  DECIMAL(5,2),
  income_accel_ratio   DECIMAL(5,2),
  profitable_ratio     DECIMAL(5,2),

  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, industry)
);
```

### stock_phases

```sql
CREATE TABLE stock_phases (
  id              SERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  symbol          VARCHAR(20) NOT NULL,
  phase           SMALLINT NOT NULL,       -- 1, 2, 3, 4
  phase_detail    JSONB,                   -- 판별에 사용된 세부 수치
  prev_phase      SMALLINT,                -- 전일 Phase
  transition_from SMALLINT,                -- Phase 전환 시작점
  transition_date DATE,                    -- Phase 전환 감지일
  ma150_slope     DECIMAL(8,4),            -- MA150 기울기
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, symbol)
);
```

### phase_detail JSONB 예시

```json
{
  "price": 185.50,
  "ma50": 178.20,
  "ma150": 165.40,
  "ma200": 158.30,
  "ma150_slope": 0.0032,
  "rs_score": 87,
  "high_52w": 195.00,
  "low_52w": 120.00,
  "pct_from_low": 54.6,
  "pct_from_high": 4.9,
  "conditions_met": ["price>ma150", "price>ma200", "ma150>ma200", "ma150_rising", "ma_ordered", "above_low_25pct", "within_high_25pct", "rs>50"]
}
```

---

## ETL Jobs

### 1. build-stock-phases.ts

**실행 시점:** 매일, 기존 screener ETL(일별 가격 + MA + RS) 완료 후
**의존성:** daily_prices, daily_ma, symbols
**출력:** stock_phases 테이블

```
Process:
1. 전체 활성 종목에 대해 Phase 판별 로직 실행
2. MA150 기울기 계산 (단순 변화율: (MA150[today] - MA150[20d ago]) / MA150[20d ago])
3. Phase 1/2/3/4 조건 매칭
4. 전일 stock_phases와 비교하여 Phase 전환 감지
5. stock_phases에 upsert
```

### 2. build-sector-rs.ts

**실행 시점:** 매일, build-stock-phases 완료 후
**의존성:** daily_prices.rs_score, symbols.sector, stock_phases, quarterly_financials
**출력:** sector_rs_daily 테이블

```
Process:
1. symbols에서 sector별 종목 그룹핑 (stock_count >= 10만)
2. 각 섹터별 daily_prices.rs_score 평균 계산
3. 섹터 RS 랭킹 매기기
4. 4주/8주/12주 전 sector_rs_daily와 비교하여 변화율 계산
5. stock_phases JOIN하여 브레드스 지표 계산
6. stock_phases JOIN하여 Phase 전환 급증 카운트
7. quarterly_financials JOIN하여 매출/이익 가속 비율 계산
8. 섹터 자체 Phase 판별
9. sector_rs_daily에 upsert
```

### 3. build-industry-rs.ts

**실행 시점:** 매일, build-stock-phases 완료 후 (build-sector-rs와 병렬 실행 가능)
**의존성:** daily_prices.rs_score, symbols.industry, stock_phases, quarterly_financials
**출력:** industry_rs_daily 테이블

```
Process:
1. symbols에서 industry별 종목 그룹핑 (stock_count >= 5만)
2. build-sector-rs와 동일한 계산, industry 단위로 적용
3. 상위 sector 컬럼 함께 저장 (드릴다운 지원)
4. industry_rs_daily에 upsert
```

### 실행 순서 및 스케줄링

```
build-stock-phases (선행 — Phase가 있어야 브레드스 계산 가능)
        ↓
build-sector-rs ─┐
                 ├── 병렬 실행 가능
build-industry-rs┘
```

```yaml
# GitHub Actions
schedule:
  - cron: '0 0 * * 1-5'  # UTC 00:00 = KST 09:00

jobs:
  build-stock-phases:
    runs-on: ubuntu-latest
    steps:
      - run: npx tsx src/etl/build-stock-phases.ts

  build-sector-rs:
    runs-on: ubuntu-latest
    needs: build-stock-phases
    steps:
      - run: npx tsx src/etl/build-sector-rs.ts

  build-industry-rs:
    runs-on: ubuntu-latest
    needs: build-stock-phases
    steps:
      - run: npx tsx src/etl/build-industry-rs.ts
```

---

## Acceptance Criteria

### 섹터 RS
- [ ] sector_rs_daily에 매일 11개+ 섹터의 RS/가속도/브레드스가 계산된다
- [ ] 섹터 RS 가속도 Top 5를 쿼리로 즉시 조회할 수 있다
- [ ] 섹터 자체 Phase가 판별된다

### Industry RS
- [ ] industry_rs_daily에 매일 모든 유효 Industry의 RS/가속도/브레드스가 계산된다
- [ ] Industry RS 가속도 Top 10을 쿼리로 즉시 조회할 수 있다
- [ ] 특정 섹터의 하위 Industry를 드릴다운 조회할 수 있다
- [ ] Industry 자체 Phase가 판별된다

### Phase 판별
- [ ] stock_phases에 매일 전체 활성 종목의 Phase가 판별된다
- [ ] Phase 1→2 전환 종목을 쿼리로 즉시 조회할 수 있다
- [ ] Phase 전환이 정확히 감지되고 이력이 기록된다

### 브레드스 & 전환 급증
- [ ] 브레드스 4개 지표(MA정배열, Phase2, RS>50, 신고가)가 정확히 계산된다
- [ ] 최근 5일 Phase 1→2 전환 급증을 감지할 수 있다
- [ ] 급증 시그널이 있는 Industry를 쿼리로 즉시 조회할 수 있다

### 펀더멘털
- [ ] 섹터/Industry별 매출 가속 종목 비율이 계산된다
- [ ] 섹터/Industry별 흑자 종목 비율이 계산된다

### 인프라
- [ ] 기존 screener DB의 테이블은 읽기만 하고 수정하지 않는다
- [ ] ETL이 실패해도 기존 screener ETL에 영향 없다 (독립 실행)

---

## Scope

**In Scope:**
- 섹터(대분류) RS 엔진: 평균/랭킹/가속도/Phase/브레드스/펀더멘털
- Industry(소분류) RS 엔진: 동일 구조
- Weinstein Phase 1/2/3/4 종목 단위 판별
- Phase 전환 감지 + 급증 감지
- 섹터/Industry 자체 Phase 판별
- 매출/이익 가속 종목 비율 집계
- 신규 DB 테이블 3개 (sector_rs_daily, industry_rs_daily, stock_phases)
- ETL 스크립트 3개
- GitHub Actions 스케줄링

**Out of Scope:**
- Agent 도구 래핑 (F2에서 처리)
- 리포트 생성 (F5에서 처리)
- 뉴스/산업 동향 수집 (F3에서 처리)
- 워치리스트/추적 (F4에서 처리)
- 거래대금 추세 분석 (향후 확장)
- screener DB 기존 테이블 수정

---

## Open Questions

- [ ] screener ETL 완료를 어떻게 감지할 것인가? (GitHub Actions workflow_run? 시간 기반?)
- [ ] Phase 판별 임계치 튜닝 — 실제 데이터로 검증 후 조정 필요
- [ ] Industry 분류에 null이나 빈 값이 있는 종목 처리 방안
