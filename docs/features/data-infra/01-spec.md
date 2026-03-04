# Feature Spec: Data Infrastructure

**Status:** Draft
**Created:** 2026-03-04
**Author:** brainstorm session
**Feature:** F1 — analyst-data-infra

---

## Overview

Agent가 주도섹터/주도주를 판별하기 위한 **데이터 기반을 구축**하는 피처.
섹터별 RS 엔진, Weinstein Phase 판별, 섹터 브레드스 계산을 ETL 파이프라인으로 매일 자동 실행.

Agent는 숫자 계산에 약하고 해석에 강하다. 따라서 **확정적인 계산은 ETL이 하고, Agent는 결과를 조회만** 한다.

---

## User Goals

- Agent가 "어떤 섹터가 가속하고 있나?"를 즉시 조회할 수 있다
- Agent가 "이 종목이 Phase 몇인가?"를 즉시 판별할 수 있다
- Agent가 "이 섹터에서 몇 %의 종목이 동반 상승 중인가?"를 즉시 확인할 수 있다
- 모든 데이터는 매일 장 마감 후 자동으로 계산되어 DB에 저장된다

---

## Behavior

### 1. 섹터 RS 엔진

**목적:** 시장 대비 어떤 섹터가 강한지, 그리고 그 강세가 **가속**하고 있는지 파악.

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

---

### 2. Weinstein Phase 판별

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

### 3. 섹터 브레드스 (Breadth)

**목적:** 섹터 내 종목들이 **동반으로** 상승하고 있는지 확인. 주도섹터의 특징은 한두 종목이 아니라 다수가 함께 오르는 것.

#### 계산 지표

| 지표 | 계산 방식 |
|------|-----------|
| MA정배열 비율 | 섹터 내 (MA50 > MA150 > MA200) 종목 수 / 전체 종목 수 |
| Phase 2 비율 | 섹터 내 Phase 2 종목 수 / 전체 종목 수 |
| RS 50 이상 비율 | 섹터 내 RS > 50 종목 수 / 전체 종목 수 |
| 신고가 비율 | 섹터 내 20일 신고가 종목 수 / 전체 종목 수 |

#### 주도섹터 시그널 기준 (참고용, Agent가 최종 판단)

- MA정배열 비율 > 60%
- Phase 2 비율 > 40%
- RS 50 이상 비율 > 60%
- 섹터 RS 4주 변화 > +5

---

## Data Model

### sector_rs_daily

```sql
CREATE TABLE sector_rs_daily (
  id            SERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  sector        VARCHAR(100) NOT NULL,
  avg_rs        DECIMAL(8,2),           -- 섹터 평균 RS
  rs_rank       INTEGER,                -- 섹터 RS 순위
  stock_count   INTEGER,                -- 섹터 내 종목 수
  change_4w     DECIMAL(8,2),           -- 4주 RS 변화 (가속도)
  change_8w     DECIMAL(8,2),           -- 8주 RS 변화
  change_12w    DECIMAL(8,2),           -- 12주 RS 변화
  ma_ordered_ratio    DECIMAL(5,2),     -- MA정배열 비율 (0-100)
  phase2_ratio        DECIMAL(5,2),     -- Phase 2 비율 (0-100)
  rs_above50_ratio    DECIMAL(5,2),     -- RS>50 비율 (0-100)
  new_high_ratio      DECIMAL(5,2),     -- 20일 신고가 비율 (0-100)
  created_at    TIMESTAMP DEFAULT NOW(),

  UNIQUE(date, sector)
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

### 1. build-sector-rs.ts

**실행 시점:** 매일, 기존 ETL(일별 가격 + RS 계산) 완료 후
**의존성:** daily_prices.rs_score, symbols.sector
**출력:** sector_rs_daily 테이블

```
Process:
1. symbols에서 sector별 종목 그룹핑 (stock_count >= 10만)
2. 각 섹터별 daily_prices.rs_score 평균 계산
3. 섹터 RS 랭킹 매기기
4. 4주/8주/12주 전 sector_rs_daily와 비교하여 변화율 계산
5. 브레드스 지표 계산 (MA정배열 비율, Phase 2 비율 등)
6. sector_rs_daily에 upsert
```

### 2. build-stock-phases.ts

**실행 시점:** 매일, build-sector-rs 완료 후 (또는 병렬 실행 가능)
**의존성:** daily_prices, daily_ma, symbols
**출력:** stock_phases 테이블

```
Process:
1. 전체 활성 종목에 대해 Phase 판별 로직 실행
2. MA150 기울기 계산 (최근 20일 선형회귀 또는 단순 변화율)
3. Phase 1/2/3/4 조건 매칭
4. 전일 stock_phases와 비교하여 Phase 전환 감지
5. stock_phases에 upsert
```

### 스케줄링

```yaml
# GitHub Actions (기존 screener ETL 이후 실행)
# 또는 별도 워크플로우

schedule:
  - cron: '0 0 * * 1-5'  # UTC 00:00 = KST 09:00 (screener ETL 완료 후)

jobs:
  build-sector-rs:
    runs-on: ubuntu-latest
    steps:
      - run: npx tsx src/etl/build-sector-rs.ts

  build-stock-phases:
    runs-on: ubuntu-latest
    needs: build-sector-rs
    steps:
      - run: npx tsx src/etl/build-stock-phases.ts
```

---

## Acceptance Criteria

- [ ] sector_rs_daily에 매일 11개+ 섹터의 RS/가속도/브레드스가 계산된다
- [ ] stock_phases에 매일 전체 활성 종목의 Phase가 판별된다
- [ ] Phase 1→2 전환 종목을 쿼리로 즉시 조회할 수 있다
- [ ] 섹터 RS 가속도 Top 5를 쿼리로 즉시 조회할 수 있다
- [ ] 브레드스 지표(MA정배열 비율, Phase 2 비율)가 정확히 계산된다
- [ ] 기존 screener DB의 테이블은 읽기만 하고 수정하지 않는다
- [ ] ETL이 실패해도 기존 screener ETL에 영향 없다 (독립 실행)
- [ ] MA150 기울기 계산이 ±0.001 이내 정확도를 가진다

---

## Scope

**In Scope:**
- 섹터별 RS 평균/랭킹/가속도 계산
- Weinstein Phase 1/2/3/4 판별 로직
- Phase 전환 감지
- 섹터 브레드스 4개 지표 계산
- 신규 DB 테이블 2개 (sector_rs_daily, stock_phases)
- ETL 스크립트 2개
- GitHub Actions 스케줄링

**Out of Scope:**
- Agent 도구 래핑 (F2에서 처리)
- 리포트 생성 (F5에서 처리)
- 뉴스/산업 동향 수집 (F3에서 처리)
- 워치리스트/추적 (F4에서 처리)
- screener DB 기존 테이블 수정

---

## Open Questions

- [ ] MA150 기울기 계산: 선형회귀 vs 단순 변화율((현재-20일전)/20일전)?
- [ ] screener ETL 완료를 어떻게 감지할 것인가? (GitHub Actions workflow_run? 시간 기반?)
- [ ] Phase 판별 임계치 튜닝 — 실제 데이터로 검증 후 조정 필요
