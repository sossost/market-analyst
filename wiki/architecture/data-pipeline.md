# Data Pipeline -- 데이터에서 인사이트까지

> 최종 갱신: 2026-04-14
> 이 문서는 FMP API 원본 데이터가 ETL을 거쳐 DB에 저장되고, Agent/Debate 시스템이 분석하여 리포트로 발행되기까지의 전체 흐름을 정리한다.

---

## 전체 흐름 요약

```
[1] Data Ingestion    FMP API --> DB (원본 저장)
         |
[2] Feature Eng.      DB --> 계산 --> DB (파생 지표)
         |
[3] Signal Scan       Phase 2 종목 자동 스캔 (게이트 필터링)
         |
[4] Agent Analysis    도구 7개 병렬 호출 --> LLM 인사이트 생성
         |
[5] Debate            4명 에이전트 3라운드 토론 --> Thesis 추출
         |
[6] Learning Loop     Thesis 검증 --> 학습 승격/강등 --> 다음 Debate에 주입
         |
[7] Report            HTML 조립 --> Supabase Storage --> Discord 발송
```

---

## [1] Data Ingestion -- 외부 데이터 수집

### 데이터 소스: FMP (Financial Modeling Prep) API

Professional 플랜. 전 엔드포인트 사용 가능.

| Job | FMP Endpoint | 대상 테이블 | 주기 |
|-----|-------------|------------|------|
| load-us-symbols | `/stable/company-screener` | `symbols` | 초기 1회 + 주 1회 갱신 |
| load-daily-prices | `/api/v3/historical-price-full/{SYMBOL}` | `daily_prices` | 매일 (기본 5일, backfill 250일) |
| load-index-prices | `/api/v3/historical-price-full/{INDEX}` | `index_prices` | 매일 (^GSPC, ^IXIC, ^DJI, ^RUT, ^VIX) |
| load-analyst-estimates | `/stable/analyst-estimates-bulk` | `analyst_estimates` | 주 1~2회 |
| load-earnings-surprises | `/stable/earnings-surprises-bulk` | `eps_surprises` | 주 1~2회 |
| load-company-profiles | `/stable/company-profile/{SYMBOL}` | `company_profiles` | 주 1회 |
| load-peer-groups | `/stable/peer-groups/{SYMBOL}` | `peer_groups` | 주 1회 |
| load-annual-financials | `/stable/income-statement/{SYMBOL}?period=annual` | `annual_financials` | 분기 1회 |
| load-quarterly-financials | `/stable/income-statement/{SYMBOL}?period=quarter` | `quarterly_financials` | 분기 1회 |
| load-ratios | `/stable/ratios/{SYMBOL}?period=quarter` | `quarterly_ratios` | 분기 1회 |
| load-price-targets | `/stable/price-targets?symbol={SYMBOL}` | `price_target_consensus` | 주 1회 |
| load-earnings-calendar | `/stable/earning_calendar?from=&to=` | `earning_calendar` | 매일 |
| load-earnings-transcripts | `/stable/earning_call_transcript/{SYMBOL}` | `earning_call_transcripts` | 분기 1회 |
| load-stock-news | FMP news endpoint | `stock_news` | 매일 (Phase 2 + 관심종목) |

### 필터링 규칙 (수집 시점)

- `isEtf = false`, `isFund = false` -- ETF/펀드 제외
- `industry != 'Shell Companies'` -- SPAC 제외 (2026-03-26 오염 사건 이후 추가)
- Ticker 검증: 1~5자 대문자, W/U/X 접미사 제외 (워런트/유닛)
- 거래소: NASDAQ, NYSE, AMEX만

---

## [2] Feature Engineering -- 파생 지표 계산

### 의존성 순서 (DAG)

```
daily_prices (원본)
  |
  +-- build-daily-ma -----> daily_ma (MA20/50/100/200, VolMA30)
  |
  +-- build-rs -----------> daily_prices.rsScore (12m/6m/3m 가중평균)
  |
  +-- [daily_ma + rs 완료 후]
       |
       build-stock-phases -> stock_phases (Phase 1/2/3/4)
       |
       +-- build-sector-rs ------> sector_rs_daily (11개 섹터)
       |
       +-- build-industry-rs ----> industry_rs_daily (135개 업종)
       |
       +-- build-market-breadth -> market_breadth_daily (시장 전체 스냅샷)
       |
       +-- build-breakout-signals -> daily_breakout_signals
       |
       +-- build-noise-signals ---> daily_noise_signals
```

### 핵심 계산 로직

**RS (Relative Strength) 스코어**
- 가중평균: 12개월(0.2) + 6개월(0.3) + 3개월(0.5)
- 중기 모멘텀을 강조하는 의도적 설계
- 전 종목 대비 퍼센타일 (0~100)

**Weinstein Phase 판정** (`build-stock-phases.ts`)
- Phase 1 (바닥 다지기): MA150 평탄, 가격이 MA 근처
- Phase 2 (상승): MA150 우상향, 가격 > MA150, RS 상승
- Phase 3 (천장): MA150 평탄화, 거래량 감소
- Phase 4 (하락): MA150 하향, 가격 < MA150

입력: daily_ma, daily_prices, symbols (최소 170일 가격 필요)
배치: 200개 심볼씩 처리
핵심 조건:
- MA150 슬로프 (기울기 방향)
- 52주 고가/저가 거리 (pctFromHigh52w, pctFromLow52w)
- 거래량 확인 (volRatio = 당일 거래량 / VolMA30)
- VDU 비율 (5일 평균 / 50일 평균 거래량)

**섹터/업종 RS** (`build-sector-rs.ts`, `build-industry-rs.ts`)
- 각 그룹 내 종목들의 평균 RS
- Phase 2 비율, MA 정렬 비율, 52주 신고가 비율
- 4주/8주/12주 RS 변화 추이
- 그룹 Phase 판정 (1/2/3/4)
- Phase 1->2 전환 카운트 (5일 윈도우)

**시장 브레드스** (`build-market-breadth.ts`)
- Phase 분포 (전체 종목 중 Phase 1/2/3/4 비율)
- 상승/하락 종목 수 (A/D ratio)
- 52주 신고가/신저가
- VIX, Fear & Greed 스코어
- 브레드스 스코어 (종합), 다이버전스 시그널

### 핵심 설정값

| 파라미터 | 값 | 용도 |
|---------|-----|------|
| RS 가중치 | 12m: 0.2, 6m: 0.3, 3m: 0.5 | 중기 모멘텀 강조 |
| MA150 슬로프 | 170일 필요 | Phase 기울기 판정 |
| 52주 | 252 거래일 | 고가/저가 거리 |
| VDU | 5일 / 50일 | 거래량 급증 감지 |
| Breakout 윈도우 | 20거래일 | 돌파 신호 |
| Breakout 거래량 | 2.0x VolMA30 | 거래량 확인 |

---

## [3] Signal Scan -- Phase 2 종목 자동 스캔

`scan-recommendation-candidates.ts` -- 매일 ETL 후 실행

### 게이트 순차 필터링

```
Phase 2 전체 종목
  |
  [Gate 1] Bear Exception -- Bear 레짐 예외 심볼 허용
  [Gate 2] Low RS -- RS < 30 제외
  [Gate 3] Overheated RS -- RS > 90 제외
  [Gate 4] Low Price -- 가격 < $5 제외
  [Gate 5] Persistence -- Phase 2 지속 30일 미만 제외
  [Gate 6] Stability -- Phase 2 안정성 21일 미만 제외
  [Gate 7] Fundamental -- SEPA 등급 필터
  [Gate 8] Late Bull -- Late Bull 레짐 추가 검증
  |
  --> tracked_stocks 테이블 INSERT (source='etl_auto', status='ACTIVE')
  --> runCorporateAnalyst (기업 심층 분석, fire-and-forget)
```

### 쿨다운

- 같은 종목 재추천 금지: 30일 캘린더
- Phase 회귀 후 재진입 시에도 적용

---

## [4] Agent Analysis -- 일간/주간 에이전트

### 실행 흐름 (공통 8단계)

```
[1] 환경 검증 (DATABASE_URL, DISCORD_WEBHOOK_URL)
[2] 최신 거래일 확인 (daily_prices 최신 날짜)
[3] 컨텍스트 로딩 (병렬, 실패해도 계속)
[4] 도구 7개 병렬 호출 --> 데이터 수집
[5] LLM 인사이트 생성 (Claude CLI, Sonnet 4.6)
[6] HTML 조립 + Supabase Storage 발행
[7] DB 저장 (daily_reports)
[8] Discord 메시지 발송
```

### 컨텍스트 로딩 (Step 3)

| 컨텍스트 | DB 출처 | 용도 |
|---------|--------|------|
| Active Theses | `theses` (status='ACTIVE') | 현재 투자 테마 |
| Narrative Chains | `narrative_chains` | 병목 체인 상태 |
| Sector Clusters | `sector_rs_daily` | 업종 클러스터 |
| Market Regime | `market_regimes` (isConfirmed=true) | 현재 시장 레짐 |
| Debate Insight | `debate_sessions` (오늘) | 오늘 토론 결과 |
| Previous Report | `daily_reports` (직전 거래일) | 맥락 유지 |

### 도구 (Step 4)

| 도구 | DB 테이블 | 반환값 |
|-----|----------|-------|
| getIndexReturns | `index_prices`, `fear_greed` | 지수 수익률, F&G 스코어 |
| getMarketBreadth | `stock_phases`, `market_breadth_daily` | Phase 분포, A/D, 신고/저가 |
| getLeadingSectors | `sector_rs_daily`, `industry_rs_daily` | 섹터/업종 RS 랭킹 |
| findTopIndustriesGlobal | `industry_rs_daily` | 절대 RS 상위 업종 |
| getUnusualStocks | `stock_phases` | 등락률/거래량 이상 종목 |
| getRisingRS | `stock_phases` | RS 상승 초기 종목 |
| getTrackedStocks | `tracked_stocks` | 트래킹 종목 현황 (구: getWatchlistStatus) |

### LLM 인사이트 (Step 5)

- 제공자: ClaudeCliProvider (로컬 CLI, 비용 $0)
- 모델: Sonnet 4.6, 타임아웃 10분
- 입력: 데이터 요약 + 컨텍스트 (Thesis, 레짐, 서사 등)
- 출력 (JSON):
  ```
  indexInterpretation, breadthInterpretation,
  sectorNarrative, industryNarrative,
  trackedStocksSummary, discordMessage, riskFactors
  ```

### Daily vs Weekly 차이

| 항목 | Daily | Weekly |
|------|-------|--------|
| 도구 모드 | mode='daily' | mode='weekly' (추이 포함) |
| 추가 데이터 | -- | getPhase2Stocks, 업종 200개 |
| 추가 처리 | -- | 펀더멘탈 검증, 4/5 예비종목 판정 |
| 추가 컨텍스트 | -- | Signal Performance, Regime History |
| Webhook | DISCORD_WEBHOOK_URL | DISCORD_WEEKLY_WEBHOOK_URL |

---

## [5] Debate System -- 멀티 에이전트 토론

### 3라운드 구조

```
[Round 1] Independent Analysis -- 4명 병렬 독립 분석
  |
  macro (Claude Sonnet)     -- 금리, 달러, 인플레
  tech (GPT-4 -> Claude CLI 폴백) -- 반도체, AI, 산업 사이클
  geopolitics (Claude Haiku) -- 무역, 정책 리스크
  sentiment (Claude Sonnet)  -- VIX, F&G, 군중 심리
  |
[Round 2] Crossfire -- 상호 검증, 4명 병렬
  |
  각자 다른 3명의 Round 1 분석을 읽고 동의/반박/보충
  |
[Round 3] Moderator Synthesis -- 단일, Claude 고정
  |
  모든 Round 1/2 출력 종합
  --> 투자자용 리포트 (7섹션)
  --> Thesis 추출 (JSON)
  --> Market Regime 판정 (JSON)
```

### Thesis 구조

```typescript
{
  agentPersona: "macro" | "tech" | "geopolitics" | "sentiment",
  thesis: string,                    // 검증 가능한 예측
  timeframeDays: 30 | 60 | 90,       // 검증 기한
  verificationMetric: string,        // "Tech Sector RS", "VIX" 등
  targetCondition: string,           // "Tech RS > 80 유지"
  confidence: "low" | "medium" | "high",
  consensusLevel: "4/4" | "3/4" | "2/4" | "1/4",
  category: "structural_narrative" | "sector_rotation" | "short_term_outlook",
  narrativeChain?: { megatrend, demandDriver, supplyChain, bottleneck }
}
```

### Thesis 저장 경로

```
Thesis 추출
  --> theses 테이블 (status='ACTIVE')
  --> narrative_chains (category='structural_narrative'만)
  --> enforceActiveThesisCap() -- 에이전트당 최대 10개, 초과시 EXPIRED
```

### Market Regime 판정

5단계: EARLY_BULL -> MID_BULL -> LATE_BULL -> EARLY_BEAR -> BEAR

확정 조건:
- high confidence: 5거래일 연속 동일 판정
- medium/low: 7거래일 연속
- VIX > 25 이면 BULL 자격 박탈
- F&G < 25 이면 극단적 공포 경고

허용 전환 맵:
```
EARLY_BULL -> [MID_BULL, EARLY_BEAR]
MID_BULL   -> [LATE_BULL, EARLY_BULL, EARLY_BEAR]
LATE_BULL  -> [MID_BULL, EARLY_BEAR]
EARLY_BEAR -> [BEAR, EARLY_BULL]
BEAR       -> [EARLY_BEAR]
```

---

## [6] Learning Loop -- 검증 -> 학습 -> 피드백

### 전체 흐름

```
[Day 1]   Debate --> Thesis 생성 (ACTIVE)
[Day 30+] verify-theses.ts --> CONFIRMED / INVALIDATED / EXPIRED
[Day 30+N] promote-learnings.ts --> Learning 승격/강등
[Day N+1] 다음 Debate --> Active Learning을 Few-shot으로 주입
```

### Thesis 검증 (`verify-theses.ts`)

```
ACTIVE thesis 중 timeframe 도달한 것:
  |
  targetCondition 파싱 시도
  |
  +-- 파싱 성공 --> 시장 데이터로 정량 검증
  |     +-- 통과 --> CONFIRMED (closeReason='verified')
  |     +-- 실패 --> INVALIDATED (closeReason='rejected')
  |
  +-- 파싱 실패 --> EXPIRED (closeReason='timeframe_exceeded')
```

### Learning 승격 (`promote-learnings.ts`)

성숙도 단계별 기준:

| 단계 | Learning 수 | 최소 적중 | 최소 적중률 | 이항검정 |
|-----|------------|---------|----------|---------|
| Bootstrap | 0~1 | 1 | 55% | 생략 |
| Cold Start | 2~4 | 2 | 55% | 생략 |
| Growth | 5~14 | 3 | 60% | 적용 |
| Normal | 15+ | 5 | 65% | 적용 |

강등 조건:
- 만료: 6개월 초과
- 성숙도 미달: hitCount < 3 (bootstrap 졸업 후)
- 적중률 하락: hitRate < 기준
- 최대 유지: 50개

### Few-Shot Injection

```
Active Learning 조회 (isActive=true)
  --> hitRate 내림차순 정렬
  --> Bull-bias 감지 시 Bear 키워드 learning 우선
  --> Debate 프롬프트의 memoryContext에 주입

예시:
  "[Confirmed, 80%] Technology RS > 80 + Fed 긍정 --> NASDAQ +1~3%
   (3건 적중, 0건 실패)"
```

---

## [7] Report System -- 리포트 생성 및 발행

### 리포트 종류

| 리포트 | 스크립트 | 주기 | 발송 채널 |
|--------|---------|------|----------|
| 일간 브레드스 리포트 | `run-daily-agent.ts` | 매 거래일 | HTML (Supabase Storage) + Discord (DISCORD_WEBHOOK_URL) |
| 주간 투자 브리핑 | `run-weekly-agent.ts` | 매주 토요일 | HTML (Supabase Storage) + Discord (DISCORD_WEEKLY_WEBHOOK_URL) |
| 기업 심층 분석 | `corporateAnalyst` | 추천 시 자동 | DB 저장 (stock_analysis_reports) |
| 주간 QA | `run-weekly-qa.ts` | 매주 | GitHub 이슈 (score < 6 시) |

### HTML 생성 과정

```
DailyReportData + DailyReportInsight + targetDate
  --> buildDailyHtml() -- 반응형 HTML (CSS 인라인)
  --> publishHtmlReport() -- Supabase Storage 업로드
  --> sendDiscordMessage() -- 요약 + Storage URL
  --> DB 저장 (daily_reports: reportDate, type, fullContent, metadata)
```

### Discord 메시지 형식

```
지수 수익률 + Phase 분포 + 주도 섹터 + 특이 종목 요약
+ "상세 리포트: {storageUrl}" 링크
```

---

## DB 테이블 도메인 맵

### A. 원본 데이터 (ETL 수집)

| 테이블 | 역할 | PK/UK |
|--------|------|-------|
| `symbols` | 종목 마스터 | PK: symbol |
| `daily_prices` | 일일 OHLCV + RS | UK: (symbol, date) |
| `daily_ma` | 이동평균 | UK: (symbol, date) |
| `index_prices` | 지수 OHLCV | UK: (symbol, date) |
| `quarterly_financials` | 분기 재무제표 | UK: (symbol, periodEndDate) |
| `quarterly_ratios` | 분기 재무비율 | UK: (symbol, periodEndDate) |
| `annual_financials` | 연간 재무제표 | UK: (symbol, fiscalYear) |
| `company_profiles` | 기업 프로필 | PK: symbol |
| `analyst_estimates` | 애널리스트 추정 | UK: (symbol, period) |
| `eps_surprises` | 어닝 서프라이즈 | UK: (symbol, actualDate) |
| `peer_groups` | 피어 그룹 | PK: symbol |
| `price_target_consensus` | 목표주가 | PK: symbol |
| `earning_calendar` | 실적 일정 | UK: (symbol, date) |
| `earning_call_transcripts` | 어닝콜 원문 | UK: (symbol, quarter, year) |
| `stock_news` | 종목 뉴스 | UK: url |
| `news_archive` | 매크로 뉴스 | UK: url |

### B. 파생 지표 (ETL 계산)

| 테이블 | 역할 | PK/UK |
|--------|------|-------|
| `stock_phases` | Weinstein Phase 판정 | UK: (symbol, date) |
| `sector_rs_daily` | 섹터 RS + 그룹 Phase | UK: (date, sector) |
| `industry_rs_daily` | 업종 RS + 그룹 Phase | UK: (date, industry) |
| `market_breadth_daily` | 시장 브레드스 스냅샷 | PK: date |
| `daily_breakout_signals` | 돌파 신호 | UK: (symbol, date) |
| `daily_noise_signals` | 노이즈/변동성 | UK: (symbol, date) |
| `daily_ratios` | 종가 기준 밸류에이션 | UK: (symbol, date) |
| `fundamental_scores` | SEPA 등급 (S/A/B/C/F) | UK: (symbol, scoredDate) |

### C. 분석/추적 (Agent/ETL 생성)

| 테이블 | 역할 | PK/UK |
|--------|------|-------|
| `tracked_stocks` | **통합 트래킹** (etl_auto/agent/thesis_aligned 진입, 90일 Phase 궤적) | UK: (symbol, entry_date) |
| `signal_log` | Phase 1->2 신호 기록 | UK: (symbol, entryDate) |
| `recommendations` | (**@deprecated** — tracked_stocks로 대체. 구 etl_auto 진입 이력) | UK: (symbol, recommendationDate) |
| `recommendation_factors` | (**@deprecated** — tracked_stocks로 대체. 구 진입 팩터 스냅샷) | UK: (symbol, recommendationDate) |
| `watchlist_stocks` | (**@deprecated** — tracked_stocks로 대체. 구 agent 진입 관심종목) | UK: (symbol, entryDate) |

### D. 토론/학습 (Debate 생성)

| 테이블 | 역할 | PK/UK |
|--------|------|-------|
| `debate_sessions` | 토론 세션 전체 기록 | UK: date |
| `theses` | 검증 가능한 예측 | PK: id |
| `narrative_chains` | 병목 체인 생애주기 | PK: id |
| `agent_learnings` | 검증된 원칙 (장기 기억) | PK: id |
| `failure_patterns` | 실패 패턴 통계 | PK: id |
| `market_regimes` | 시장 레짐 | UK: regimeDate |

### E. 리포트/QA

| 테이블 | 역할 | PK/UK |
|--------|------|-------|
| `daily_reports` | 일간/주간 리포트 | UK: (reportDate, type) |
| `stock_analysis_reports` | 종목 심층 분석 | UK: (symbol, recommendationDate) |
| `weekly_qa_reports` | 주간 QA 결과 | UK: qaDate |

### F. 패턴 분석

| 테이블 | 역할 | PK/UK |
|--------|------|-------|
| `sector_phase_events` | Phase 전이 이벤트 | UK: (date, entityType, entityName, fromPhase, toPhase) |
| `sector_lag_patterns` | 리더-팔로워 시차 통계 | UK: (entityType, leaderEntity, followerEntity, transition) |
| `signal_params` | 시그널 파라미터 변경 이력 | PK: id |

---

## 핵심 의존성 DAG (전체)

```
FMP API
  |
  v
symbols, daily_prices, index_prices, quarterly_financials, ...
  |
  v
daily_ma, daily_prices.rsScore
  |
  v
stock_phases (Phase 1/2/3/4)
  |
  +------+------+------+
  |      |      |      |
  v      v      v      v
sector  industry market  breakout/
_rs     _rs      breadth noise signals
  |      |      |
  v      v      v
scan_recommendation_candidates
  |
  v
tracked_stocks (source='etl_auto')
  |
  v
run-daily-agent / run-weekly-agent
  |
  +-- 도구 7개 (DB 쿼리) --> DailyReportData
  +-- 컨텍스트 (theses, chains, regime) --> 프롬프트
  +-- Claude CLI (Sonnet) --> 인사이트 JSON
  +-- buildHtml --> 반응형 HTML
  +-- publishHtmlReport --> Supabase Storage
  +-- Discord 발송
  +-- daily_reports 저장

debateEngine (별도 실행)
  |
  +-- 4명 LLM 토론 (3라운드)
  +-- theses, narrative_chains 저장
  +-- market_regimes 판정
  |
  v
verify-theses (ETL)
  |
  v
promote-learnings (ETL)
  |
  v
agent_learnings (Active)
  |
  v
[다음 Debate의 Few-shot 컨텍스트로 주입]
```

---

## 실행 스케줄

### 일간 (매 거래일)

```
[KST 06:30] ETL 시작
  1. load-daily-prices
  2. load-index-prices
  3. build-daily-ma
  4. build-rs
  5. build-stock-phases
  6. build-sector-rs + build-industry-rs (병렬)
  7. build-market-breadth
  8. build-breakout-signals + build-noise-signals (병렬)
  9. scan-recommendation-candidates
  10. update-recommendation-status
  11. verify-theses

[KST 07:00~] Agent 실행
  12. run-daily-agent --> HTML + Discord

[KST ~07:30] 완료
```

### 주간 (매주 금요일)

```
일간 ETL 완료 후:
  13. load-analyst-estimates
  14. load-company-profiles
  15. promote-learnings
  16. run-weekly-agent --> HTML + Discord
```

---

## 핵심 임계값 참조

| 파라미터 | 값 | 위치 |
|---------|-----|------|
| RS 가중치 | 12m:0.2, 6m:0.3, 3m:0.5 | build-rs.ts |
| Phase 판정 최소 데이터 | 170일 | build-stock-phases.ts |
| 52주 기간 | 252 거래일 | build-stock-phases.ts |
| RS 하한 (게이트) | 30 | scan-recommendation-candidates.ts |
| RS 상한 (게이트) | 90 | scan-recommendation-candidates.ts |
| 최소 가격 (게이트) | $5 | scan-recommendation-candidates.ts |
| Phase 2 지속 요구 | 30일 | scan-recommendation-candidates.ts |
| Phase 2 안정성 요구 | 21일 | scan-recommendation-candidates.ts |
| 재추천 쿨다운 | 30일 | scan-recommendation-candidates.ts |
| Regime 확정 (high) | 5일 연속 | regimeStore.ts |
| Regime 확정 (med/low) | 7일 연속 | regimeStore.ts |
| Regime 쿨다운 | 14일 | regimeStore.ts |
| VIX 스트레스 임계 | 25 | regimeStore.ts |
| F&G 공포 임계 | 25 | regimeStore.ts |
| 에이전트당 최대 Thesis | 10 | thesisStore.ts |
| 최대 Active Learning | 50 | promote-learnings.ts |
| Learning 만료 | 6개월 | promote-learnings.ts |
| 성숙도 최소 적중 | 3 | promote-learnings.ts |
