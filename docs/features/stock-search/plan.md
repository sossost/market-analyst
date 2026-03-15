# 종목 검색 분석 — 대시보드 페이지 (Phase 1)

## 선행 맥락

관련 결정/교훈 없음. 이 기능은 최초 기획이다.

---

## 골 정렬

**ALIGNED** — 직접 기여.

탑다운 흐름(시장 → 섹터 → 주도주)과 역방향(종목 → 섹터/산업 위치 확인)은 같은 골을 섬긴다.
특정 종목의 Phase 위치, RS, SEPA 등급, 섹터 맥락을 한 화면에 보여줌으로써 "이 종목이 Phase 2 초입인가"를 즉시 판단할 수 있게 한다. 에이전트 추천 이력 연결도 검증 루프를 강화한다.

---

## 문제

현재 대시보드는 "시장 전체 → 주도섹터 → 주도주"의 탑다운 뷰만 제공한다.
특정 종목의 현재 위치(Phase, RS, 섹터 내 순위)를 역방향으로 조회할 수단이 없어, 외부에서 종목을 접했을 때 빠른 판단이 불가능하다.

---

## Before → After

**Before**: 특정 ticker에 관심이 생기면 → 에이전트 리포트 / 외부 툴을 수동으로 열어 각각 확인해야 함.

**After**: 대시보드 검색창에 ticker 입력 → 기술적 위치(Phase, MA, RS), 펀더멘탈(SEPA 등급, EPS 추이), 섹터/산업 맥락, 추천 이력이 단일 페이지에 집약되어 즉시 판단 가능.

---

## 변경 사항

### 라우팅 (신규)
- `/stocks/[symbol]` — 종목 분석 페이지 (Server Component, SSR)
- `/stocks` — 검색 랜딩 (검색창만 있는 단순 페이지 또는 `/stocks?q=` redirect)

### 사이드바 네비게이션 추가
- `frontend/src/shared/components/layout/nav-items.ts` — `{ href: '/stocks', label: '종목 검색', icon: Search }` 항목 추가

### 신규 feature 모듈: `frontend/src/features/stock-search/`
```
stock-search/
├── components/
│   ├── StockSearchInput.tsx        # 검색창 + 자동완성 (Client Component)
│   ├── StockNotFound.tsx           # 조회 결과 없음 상태
│   ├── StockSearchSkeleton.tsx     # 로딩 스켈레톤
│   ├── BasicInfoCard.tsx           # 기본 정보 (종목명, 섹터, 산업, 시가총액)
│   ├── TechnicalCard.tsx           # 기술적 위치 (Phase, MA선 대비 현재가)
│   ├── RSCard.tsx                  # 상대강도 (RS Score + 4w/8w/12w 변화)
│   ├── FundamentalCard.tsx         # SEPA 등급 + 최근 4분기 EPS/매출 추이
│   ├── SectorContextCard.tsx       # 섹터 RS·Phase·Phase2 비율·섹터 내 순위
│   ├── IndustryContextCard.tsx     # 산업 RS·Phase·산업 내 순위
│   └── RecommendationHistoryCard.tsx # 과거 추천 이력 + PnL
├── lib/
│   └── supabase-queries.ts         # 종목 조회 관련 Supabase 쿼리
└── types.ts                        # StockProfile, SectorContext 등 타입 정의
```

### 신규 페이지
- `frontend/src/app/(main)/stocks/page.tsx` — 검색 랜딩
- `frontend/src/app/(main)/stocks/[symbol]/page.tsx` — 종목 분석 상세

---

## 기술 설계

### 데이터 인프라 검증 결과 (Drizzle 스키마 기반)

| 표시 항목 | 테이블 | 컬럼 | 검증 |
|-----------|--------|------|------|
| 종목명, 섹터, 산업, 시가총액 | `symbols` | `company_name`, `sector`, `industry`, `market_cap` | 존재 |
| Phase, MA150 기울기 | `stock_phases` | `phase`, `ma150_slope`, `pct_from_high_52w`, `pct_from_low_52w` | 존재 |
| 현재가, MA선 대비 | `daily_prices` + `daily_ma` | `close`, `ma20/50/100/200` | 존재 |
| RS Score, 4w/8w/12w 변화 | `stock_phases` (rs_score) + `sector_rs_daily` (change_4w/8w/12w) | 존재 |
| SEPA 등급 | `fundamental_scores` | `grade`, `total_score`, `criteria` | 존재 |
| EPS/매출 추이 (최근 4분기) | `quarterly_financials` | `eps_diluted`, `revenue`, `period_end_date` | 존재 |
| 섹터 RS·Phase·Phase2 비율 | `sector_rs_daily` | `avg_rs`, `group_phase`, `phase2_ratio`, `rs_rank`, `change_4w/8w/12w` | 존재 |
| 섹터 내 주식 순위 | `stock_phases` + `symbols` 조인 → 집계 | 계산 필요 (쿼리 설계 포함) |
| 산업 RS·Phase | `industry_rs_daily` | `avg_rs`, `group_phase`, `phase2_ratio`, `rs_rank` | 존재 |
| 산업 내 순위 | `stock_phases` + `symbols` 조인 → 집계 | 계산 필요 |
| 추천 이력 | `recommendations` | `recommendation_date`, `entry_price`, `pnl_percent`, `status`, `close_reason` | 존재 |

**주의**: `daily_prices.rs_score`와 `stock_phases.rs_score`는 중복 컬럼. 검색 쿼리에서는 `stock_phases`의 최신 레코드를 기준으로 한다.

### API 설계 (Supabase Direct — Next.js Server Component)

자체 API Route 없음. Server Component에서 Supabase 직접 조회 (기존 패턴 동일).

**쿼리 1: 자동완성 (`StockSearchInput` — Client Component)**
```sql
SELECT symbol, company_name, sector
FROM symbols
WHERE (symbol ILIKE '%{query}%' OR company_name ILIKE '%{query}%')
  AND is_etf = false AND is_fund = false
ORDER BY market_cap DESC
LIMIT 10
```
- Route Handler `/api/stocks/search?q=` 로 분리 필요 (Client Component에서 호출)

**쿼리 2: 종목 기본 + 기술적 정보 (Server Component)**
```sql
-- symbols JOIN stock_phases (latest date) JOIN daily_prices (latest) JOIN daily_ma (latest)
SELECT
  s.symbol, s.company_name, s.sector, s.industry, s.market_cap,
  sp.phase, sp.ma150_slope, sp.rs_score, sp.pct_from_high_52w, sp.pct_from_low_52w,
  dp.close, dp.date,
  dm.ma20, dm.ma50, dm.ma100, dm.ma200
FROM symbols s
LEFT JOIN stock_phases sp ON sp.symbol = s.symbol AND sp.date = (
  SELECT MAX(date) FROM stock_phases WHERE symbol = s.symbol
)
LEFT JOIN daily_prices dp ON dp.symbol = s.symbol AND dp.date = (
  SELECT MAX(date) FROM daily_prices WHERE symbol = s.symbol
)
LEFT JOIN daily_ma dm ON dm.symbol = s.symbol AND dm.date = dp.date
WHERE s.symbol = '{symbol}'
```

**쿼리 3: 섹터/산업 맥락 (Server Component)**
```sql
SELECT avg_rs, rs_rank, group_phase, phase2_ratio, change_4w, change_8w, change12w, stock_count
FROM sector_rs_daily
WHERE sector = '{sector}' AND date = (SELECT MAX(date) FROM sector_rs_daily)
```

**쿼리 4: 섹터 내 순위 계산 (Server Component)**
```sql
SELECT COUNT(*) as total,
  SUM(CASE WHEN sp.rs_score >= (현재 종목 rs_score) THEN 1 ELSE 0 END) as rank
FROM stock_phases sp
JOIN symbols s ON s.symbol = sp.symbol
WHERE s.sector = '{sector}'
  AND sp.date = (SELECT MAX(date) FROM stock_phases)
```

**쿼리 5: 펀더멘탈 (Server Component)**
```sql
-- fundamental_scores 최신 레코드
SELECT grade, total_score, criteria FROM fundamental_scores
WHERE symbol = '{symbol}'
ORDER BY scored_date DESC LIMIT 1

-- quarterly_financials 최근 4분기
SELECT period_end_date, eps_diluted, revenue FROM quarterly_financials
WHERE symbol = '{symbol}'
ORDER BY period_end_date DESC LIMIT 4
```

**쿼리 6: 추천 이력 (Server Component)**
```sql
SELECT recommendation_date, entry_price, current_price, pnl_percent, max_pnl_percent,
  status, close_date, close_reason, entry_phase
FROM recommendations
WHERE symbol = '{symbol}'
ORDER BY recommendation_date DESC
LIMIT 10
```

### 컴포넌트 트리

```
/stocks/[symbol]/page.tsx (Server Component — 모든 쿼리 병렬 실행)
├── StockSearchInput (Client — 검색창, 상단 고정)
├── BasicInfoCard (symbol, name, sector, industry, market_cap)
├── TechnicalCard
│   ├── PhaseBadge
│   └── MAComparisonGrid (close vs ma20/50/100/200)
├── RSCard (rs_score + sparkline 4w/8w/12w trend)
├── FundamentalCard
│   ├── SEPAGradeBadge
│   └── EPSRevenueTable (최근 4분기)
├── SectorContextCard (sector rs, phase, phase2 ratio, 순위)
├── IndustryContextCard (industry rs, phase, 순위)
└── RecommendationHistoryCard (이력 테이블, 없으면 EmptyState)
```

### 데이터 흐름

1. URL `/stocks/[symbol]`로 진입
2. Server Component에서 6개 쿼리를 `Promise.all`로 병렬 실행
3. `symbol` 없거나 `symbols` 테이블에 없으면 `notFound()` → 404
4. 각 카드에 데이터 prop으로 전달 (Client Component 없음, 단 `StockSearchInput` 제외)
5. `StockSearchInput`은 페이지 상단에 고정 — 다른 종목으로 빠르게 전환 가능

### 자동완성 Route Handler

`frontend/src/app/api/stocks/search/route.ts`
- GET `?q={query}` — `symbols` 테이블 ILIKE 검색, 결과 10개 반환
- 인증 필요 (기존 미들웨어로 보호됨)

---

## 구현 단계

### Phase 1 — 라우팅 + 기본 정보 카드 (기초 골격)
- [ ] `frontend/src/app/(main)/stocks/page.tsx` 생성 — 검색 랜딩 (검색창 + 안내 문구)
- [ ] `frontend/src/app/(main)/stocks/[symbol]/page.tsx` 생성 — 상세 페이지 골격 + notFound 처리
- [ ] `stock-search/types.ts` — `StockProfile`, `SectorContext`, `IndustryContext`, `RecommendationRecord` 타입 정의
- [ ] `stock-search/lib/supabase-queries.ts` — 쿼리 1~6 구현
- [ ] `BasicInfoCard.tsx` — 종목명, 섹터, 산업, 시가총액
- [ ] `StockSearchSkeleton.tsx`, `StockNotFound.tsx`
- [ ] `nav-items.ts` — 사이드바에 "종목 검색" 추가

**완료 기준**: `/stocks/AAPL` 접속 시 기본 정보 카드 렌더링.

### Phase 2 — 기술적 분석 + RS 카드
- [ ] `TechnicalCard.tsx` — Phase 배지, MA 대비 현재가 (%, 색상)
- [ ] `RSCard.tsx` — RS Score 게이지, 4w/8w/12w 변화 방향 표시
- [ ] `PhaseBadge.tsx` (shared 또는 feature 내) — Phase 1/2/3/4 색상 구분

**완료 기준**: 기술적 카드 + RS 카드 정확하게 렌더링. Phase 배지 색상 스펙 충족.

### Phase 3 — 펀더멘탈 + 섹터/산업 맥락
- [ ] `FundamentalCard.tsx` — SEPA 등급 배지, 최근 4분기 EPS/매출 테이블 (QoQ 변화율 포함)
- [ ] `SectorContextCard.tsx` — 섹터 RS, Phase, Phase2 비율, 섹터 내 순위 (X/N)
- [ ] `IndustryContextCard.tsx` — 산업 RS, Phase, Phase2 비율, 산업 내 순위
- [ ] 섹터/산업 내 순위 계산 쿼리 검증

**완료 기준**: SEPA 등급 + EPS 추이 + 섹터/산업 맥락 카드 정확 렌더링.

### Phase 4 — 자동완성 검색 + 추천 이력 + 마무리
- [ ] `frontend/src/app/api/stocks/search/route.ts` — 자동완성 Route Handler
- [ ] `StockSearchInput.tsx` — combobox 패턴, debounce 300ms, 키보드 네비게이션
- [ ] `RecommendationHistoryCard.tsx` — 이력 테이블, 없으면 EmptyState
- [ ] 모바일 레이아웃 검증 (375px 기준)
- [ ] 단위 테스트 (supabase-queries.ts, 타입 변환 함수)

**완료 기준**: 전체 기능 작동. 자동완성에서 종목 선택 시 상세 페이지 이동. 모바일 정상 표시.

---

## 리스크

1. **섹터/산업 내 순위 쿼리 성능**: `stock_phases` 테이블 전체 스캔이 필요. 최신 date에 대한 인덱스(`idx_stock_phases_date`)는 존재하나, 섹터 필터 조합 쿼리가 느릴 수 있음. 초기에는 결과 캐시 없이 진행, 느리면 별도 집계 뷰 검토.

2. **RS 4w/8w/12w 변화**: `sector_rs_daily`에는 해당 컬럼이 있으나 `stock_phases`에는 없음. 종목 개별 RS 추이를 보려면 `daily_prices.rs_score` 과거 N일 조회가 필요. 초기에는 현재 RS Score만 표시하고, 추이는 `daily_prices`에서 4w/8w/12w 전 레코드를 조인하는 방식으로 구현. (데이터 없으면 "-" 처리)

3. **`fundamental_scores` 최신 데이터 갭**: SEPA 스코어링 주기에 따라 최신 scored_date와 오늘 사이에 갭이 있을 수 있음. 마지막 scored_date를 함께 표시하여 데이터 freshness를 명시.

4. **자동완성 검색 속도**: ILIKE는 인덱스를 사용하지 못함. `symbols` 테이블 크기에 따라 응답이 느릴 수 있음. `pg_trgm` 인덱스가 없다면 결과가 많을 경우 체감 가능. market_cap DESC 정렬로 상위 종목을 우선 노출하여 실용적 해결.

---

## 의사결정 사항

없음 — 아래 사항은 자율 판단으로 결정함.

| 항목 | 결정 | 근거 |
|------|------|------|
| API Route vs Server Component 직접 쿼리 | Server Component 직접 쿼리 (기존 패턴 동일) | reports, debates, dashboard 모두 동일 방식 |
| 자동완성 방식 | 별도 Route Handler (`/api/stocks/search`) | Client Component에서 호출 필요, Server Component 불가 |
| 섹터 내 순위 | 쿼리 시 실시간 계산 (캐시 없음) | 초기 구현 단순화. 느리면 뷰로 전환 |
| RS 추이 표시 | `daily_prices` 과거 레코드 조인 방식 | 별도 집계 테이블 불필요 |
| 페이지 레이아웃 | 세로 단일 컬럼 (모바일), 2컬럼 그리드 (md 이상) | 기존 대시보드 패턴 동일 |
| 자동완성 라이브러리 | shadcn/ui Command 컴포넌트 활용 | 이미 shadcn/ui 사용 중, 추가 의존성 없음 |
