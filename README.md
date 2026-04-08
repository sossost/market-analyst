# Market Analyst Agent

Claude Agent가 자율적으로 시장을 분석하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 멀티 애널리스트 토론 + 펀더멘탈 검증 + 학습 루프를 통해 **시간이 지날수록 똑똑해지는** 시장 분석 시스템.

> **Backend** 206 TS files · **Tests** 102 files · **Open Issues** 11 · **Frontend** → control-tower 레포로 이관

## How It Works

```
1. ETL 파이프라인 (매일 장 마감 후)
   → 미장 휴일 자동 감지: Phase 1(가격 수집) 직후 DB MAX(date) 비교 → 휴일이면 Phase 2 이후 전체 스킵 (토론·리포트 포함)
   → Weinstein Phase 판별, 섹터/산업 RS 계산, 브레드스 분석

2. 멀티 모델 애널리스트 토론 (매일 22:00 UTC)
   → 매크로(GPT-4o)/테크(Gemini 2.5 Flash)/지정학(Claude)/심리(Claude) 4명이 3라운드 토론
   → 멀티 모델 다양성으로 확증편향 구조적 완화 + 외부 API 장애 시 Claude 자동 폴백
   → 조기포착 도구 3종(Phase1Late/RisingRS/펀더멘탈가속) 결과를 Round 1·3에 주입
   → 교집합 필터: 2+도구에 동시 등장하는 종목을 "고확신 후보"로 별도 태깅 (#593)
   → 촉매 데이터(종목 뉴스/실적 서프라이즈 비트율/임박 실적 발표) 주입 — "왜 지금 이 섹터가 강한가" 근거 강화
   → 수요-공급-병목 프레임으로 구조적 서사 도출
   → N+1 병목 예측: "현재 병목 해소 후 다음 제약은?"
   → 공급 과잉 전환 감지: 병목 해소 → 과잉 전환 조기 포착
   → 병목 체인 추적: narrative_chains 테이블에 병목 생애주기 기록
   → 모더레이터(Claude)가 thesis 구조화 + 합의도(consensus_score) 기록

3. 학습 루프 (자동)
   → ACTIVE thesis를 시장 데이터로 검증 (CONFIRMED/INVALIDATED)
   → 원인 분석: LLM이 "왜 맞았는지/틀렸는지" 인과 체인 추출
   → 반복 적중 패턴 → 장기 기억(agent_learnings)으로 승격
   → 실패 패턴 자동 축적: Phase 2 신호 후 실패 조건 기록 → 70%+ 실패율 패턴은 필터링 규칙으로 승격
   → 유사 시장 조건의 과거 세션을 few-shot으로 주입

4. 섹터 시차 패턴 (자동)
   → 섹터/산업 Phase 전이 이벤트 매일 감지 + 기록
   → 섹터 쌍별 시차 통계 축적 (평균, 표준편차, 신뢰 구간)
   → "A 섹터 Phase 2 진입 → N주 후 B 섹터 주시" 선행 경보
   → 신뢰 가능 패턴(5회+ 관측)만 주간 에이전트에 주입

5. 품질 관리 (자동)
   → 일간 리포트 품질 검증 파이프라인 (Claude Code CLI 기반)
   → 조건부 발송 게이트: 품질 미달 시 발송 차단
   → bull-bias 감지 + Phase 2 ratio 이중 변환 방어
   → QA 이슈 기준 강화: 총점 ≤32 OR factConsistency < 7 → GitHub 이슈 자동 생성
   → 교차 리포트 정합성: 일간/토론 reported_symbols 불일치 감지 (warn-only)
   → 급락 종목 경고: -5% + 거래량 1.5x 시 Discord 경고 카테고리 삽입
   → 도구 에러 자동 감지: Discord 즉시 알림 + GitHub 이슈 자동 생성 + 핵심 도구 실패 추적
   → 토론 품질 경고: 애널리스트 실패·Thesis 검증 실패·촉매 로드 실패 시 Discord 경고 발송

6. 기업 애널리스트 (추천 종목별 자동 생성)
   → 피어 멀티플(P/E·EV/EBITDA·P/S) 가중 평균 기반 정량 목표주가 산출
   → 월가 컨센서스 교차 검증 (ALIGNED/DIVERGENT/LARGE_DIVERGENT)
   → LLM은 정량 결과를 해석만 — 숫자를 만들어내지 않음
   → 어닝콜 핵심 발언, 포워드 EPS, 피어 비교 등 Seeking Alpha 수준 리포트

7. 에이전트 리포트
   → 일간: 시장 온도 + 시장 환경 멀티게이트(S&P 500 MA·신고가>신저가·A/D) + 토론 핵심 발견 + 관심종목 현황 브리핑 (조건부 발송)
   → 주간: 지표 4×2 그리드(10Y·DXY·공포탐욕 통합) + 시장 브레드스(Phase 분포·5일 추이·LLM 해석) + 섹터 로테이션 + 업종 RS Top 10 + 관심종목 궤적 + 5중 게이트 + 다음 주 관전 포인트 (HTML 리포트 + Discord 요약)
   → S등급(Top 3): 개별 종목 심층 리포트 발행

8. 전략 참모 (매일 04:00)
   → 8개 영역 시스템 분석 (포착 로직, 학습 루프, 추천 성과 등)
   → strategic-briefing.md 갱신 — 매니저의 골 정렬 판단 근거
   → 가치 있는 인사이트만 GitHub 이슈로 생성 (최대 3건/일)

9. 자율 운영
   → Issue Triage: 미트리아지 이슈 사전 분류 (매일 09:00)
   → Issue Processor: triaged 이슈 → Claude Code CLI 자동 구현 → PR 생성 (10:00~02:00)
   → PR Reviewer: PR Strategic + Code 병렬 리뷰 → GitHub 코멘트 자동 게시 (09:15~02:15)
   → 맥미니 서버 launchd 기반 스케줄링 (10개 작업)
```

## Quick Start

### Prerequisites

- Node.js >= 20
- Yarn (Classic 1.x)
- PostgreSQL (Supabase) — screener DB와 공유
- API Keys: Anthropic, OpenAI, Google Generative AI, Discord Webhook, Brave Search, GitHub Token

### Setup

```bash
git clone https://github.com/sossost/market-analyst.git
cd market-analyst
yarn install
cp .env.example .env  # 환경변수 설정
```

### Environment Variables

```env
DATABASE_URL=postgresql://...               # Supabase 연결
ANTHROPIC_API_KEY=sk-ant-...                # Claude API
OPENAI_API_KEY=sk-...                       # GPT-4o (매크로 애널리스트)
GOOGLE_GENERATIVE_AI_API_KEY=AI...          # Gemini 2.5 Flash (테크 애널리스트)
DISCORD_WEBHOOK_URL=https://...             # 일간 리포트 채널
DISCORD_WEEKLY_WEBHOOK_URL=https://...      # 주간 리포트 채널
DISCORD_STOCK_REPORT_WEBHOOK_URL=https://...  # S등급 종목 리포트 채널
DISCORD_ERROR_WEBHOOK_URL=https://...       # 에러 알림 채널 (optional)
BRAVE_API_KEY=BSA...                        # 카탈리스트 뉴스 검색
GITHUB_TOKEN=gho_...                        # Gist MD 첨부 (Supabase 미설정 시 fallback)
SUPABASE_URL=https://...supabase.co         # HTML 리포트 Storage 업로드 (optional)
SUPABASE_SERVICE_KEY=eyJ...                 # Supabase service_role key (optional)
```

### Run

```bash
# ETL 파이프라인
yarn etl:stock-phases       # Weinstein Phase 판별 + 거래량 돌파 신호(breakoutSignal)
yarn etl:sector-rs          # 섹터 RS 계산
yarn etl:industry-rs        # 산업 RS 계산
yarn etl:index-prices       # 지수 가격 (S&P 500, NASDAQ, DOW, Russell 2000, VIX)
yarn etl:stock-news         # 종목 뉴스 수집 (Phase 2 + 관심종목)
yarn etl:earning-calendar   # 실적 발표 일정 수집 (-7일 ~ +30일)
yarn etl:earnings-surprises-fmp  # EPS 서프라이즈 수집 (최근 4분기)
yarn etl:validate           # 데이터 검증
yarn etl:update-watchlist   # 관심종목 Phase 궤적 업데이트
yarn etl:verify-theses      # thesis 시장 데이터 검증
yarn etl:failure-patterns   # Phase 2 실패 패턴 수집
yarn etl:promote-learnings  # 반복 적중 패턴 → 장기 기억 승격

# 신호 성과 추적
yarn signal:record          # 신규 신호 기록
yarn signal:update          # 신호 수익률 업데이트
yarn signal:track-exits     # Phase 이탈 추적

# Agent 실행
yarn agent:daily            # 일간 시장 브리핑
yarn agent:weekly           # 주간 종목 분석
yarn agent:debate           # 애널리스트 토론 (매크로/테크/지정학/심리)
yarn agent:qa               # 주간 QA 분석
yarn agent:corporate-analyst  # 기업 애널리스트 수동 실행
yarn agent:issue-processor  # 자율 이슈 처리 (Claude Code CLI)

# 테스트
yarn test                   # 전체 테스트 (102 test files)
yarn test:watch             # 워치 모드
yarn typecheck              # 타입 체크

# DB
yarn db:generate            # 마이그레이션 생성
yarn db:push                # 스키마 적용
yarn db:studio              # Drizzle Studio UI
```

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     ETL      │    │Multi-Model   │    │    Agent     │
│              │    │   Debate     │    │              │
│ Stock Phases │───▶│GPT-4o/Gemini│───▶│Claude Sonnet │
│ Sector RS    │    │/Claude 4명   │    │ + 19 Tools   │
│ Industry RS  │    │ + 서사 프레임 │    │ + Fundamental│
│ Breakout/    │    └──────┬───────┘    └──────┬───────┘
│ Noise Signal │           │                   │
└──────┬───────┘    ┌──────▼───────┐           │
       └───────────▶│  Learning    │◀──────────┘
                    │    Loop      │
                    └──────┬───────┘
                           │
               ┌───────────┼───────────┐
               │           │           │
        ┌──────▼──┐  ┌─────▼────┐  ┌──▼───────┐
        │ Thesis  │  │ Causal   │  │ Few-shot  │
        │ Verify  │  │ Analysis │  │ Injection │
        └─────────┘  └──────────┘  └──────────┘
                           │
                    ┌──────▼───────┐
                    │  QA + Gate   │
                    │ (품질 검증)   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Delivery   │
                    │Discord+HTML  │
                    └──────┬───────┘
                           │
               ┌───────────┘
               │
        ┌──────▼──┐  ┌──────────┐
        │Supabase │  │ Auto     │
        │   (DB)  │  │Issue Proc│
        └─────────┘  └──────────┘
```

### Agent Tools

| 도구 | 일간 | 주간 | 설명 |
|------|:----:|:----:|------|
| `getIndexReturns` | O | O | 4대 지수 + VIX + US 10Y + DXY + 공포탐욕지수 — FMP 데이터 기반, DB 우선 조회 (주간: 누적 + 고저 위치) |
| `getMarketBreadth` | O | O | Phase 분포, Phase 2 비율, A/D ratio (주간: 5일 추이 + Phase 1→2 전환) |
| `getLeadingSectors` | O | O | RS 상위 섹터/업종 (주간: 전주 대비 순위 변동 + 신규 진입/이탈; industry 모드: 전체 업종 RS 랭킹 + divergence; Phase 전환 섹터: 업종 드릴다운 자동 포함) |
| `getPhase2Stocks` | | O | Phase 2 초입 종목 리스트 (RS 필터링) |
| `getPhase1LateStocks` | O | O | Phase 1 후기 종목 — Volume Dry-Up(VDU) + 거래량 회복 패턴으로 Phase 2 진입 1~3개월 선행 포착 |
| `getRisingRS` | O | O | RS 30~70 상승 가속 종목 — 초기 모멘텀 포착 (SEPA 등급 + 시총 구간 포함) |
| `getFundamentalAcceleration` | | O | EPS/매출 성장 가속 종목 (Phase 1~2 대상) |
| `getUnusualStocks` | O | | 복합 조건 특이종목 스크리닝 (등락률·거래량·Phase 전환) |
| `getStockDetail` | O | O | 개별 종목 상세 분석 (Phase, RS, MA, 섹터 컨텍스트) |
| `searchCatalyst` | O | O | Brave Search 뉴스 기반 카탈리스트 |
| `readReportHistory` | | O | 과거 리포트 이력 (중복 방지) |
| `readRecommendationPerformance` | | O | 추천 성과 트래킹 (주간: 신규/종료/Phase 이탈 집계) |
| `getWatchlistStatus` | O | O | 관심종목 현황 + Phase 궤적 (일간: 현재 상태, 주간: 90일 궤적) |
| `saveWatchlist` | | O | 관심종목 DB 저장 |
| `readRegimePerformance` | | O | 레짐별 신호 성과 통계 (BULL/BEAR/LATE_BULL 등) |
| `saveRecommendations` | O | O | 추천 종목 DB 저장 (팩터 스냅샷 포함) |
| `saveReportLog` | O | O | 리포트 결과 저장 |
| `sendDiscordReport` | — | — | Discord + Gist 리포트 발송 (리뷰 파이프라인 내부 전용) |

### Learning Loop

예측을 기록 → 검증 → 원인 분석 → 패턴 축적하는 자기 개선 시스템:

```
토론에서 thesis 추출
  → ACTIVE 상태로 DB 저장
  → 매일 시장 데이터로 자동 검증 (CONFIRMED/INVALIDATED/HOLD)
  → 원인 분석: "왜 맞았는지/틀렸는지" LLM 분석 → causal_analysis 저장
  → 3회+ 적중 패턴 → agent_learnings로 승격
  → 유사 시장 조건 과거 세션 → few-shot 주입
```

| 구성 요소 | 파일 | 역할 |
|-----------|------|------|
| Thesis Store | `thesisStore.ts` | thesis 저장, 만료, 에이전트별 ACTIVE 상한(10건), 통계, 카테고리별 관리 |
| Thesis Verifier | `thesisVerifier.ts` | LLM 기반 자동 검증 |
| Causal Analyzer | `causalAnalyzer.ts` | 검증 결과 원인 분석, 패턴 추출 |
| Session Store | `sessionStore.ts` | 토론 세션 저장, 유사 세션 검색 |
| Memory Loader | `memoryLoader.ts` | 학습 + 검증 결과 프롬프트 주입 |
| Catalyst Loader | `catalystLoader.ts` | 종목 뉴스/실적 서프라이즈/임박 실적 발표 → 촉매 컨텍스트 |
| Promote Learnings | `promote-learnings.ts` | 반복 적중 패턴 → 장기 기억 승격 |
| Failure Tracker | `collect-failure-patterns.ts` | Phase 2 실패 조건 자동 기록 + 패턴 축적 |
| Narrative Chain | `narrativeChainService.ts` | 병목 생애주기 추적 (식별→해소→다음 병목) |
| Sector Lag Stats | `sectorLagStats.ts` | 섹터 쌍별 Phase 전이 시차 통계 + 선행 경보 |
| Bias Detector | `biasDetector.ts` | bull-bias 80% 초과 경고 |
| Statistical Tests | `statisticalTests.ts` | 이항 검정 + Cohen's h 유의성 필터 |

### Thesis 카테고리

| 카테고리 | 설명 | 기본 검증 주기 |
|----------|------|---------------|
| `structural_narrative` | 수요-공급-병목 구조적 서사 | 8~12주 |
| `sector_rotation` | 섹터 로테이션 전망 | 2~4주 |
| `short_term_outlook` | 단기 시장 전망 | 1~2주 |

### 합의도 추적 & 실패 패턴

- **합의도(consensus_score)**: 4명 애널리스트 중 동의한 수. 만장일치(4/4) vs 다수(3/4) 적중률 분리 추적 — "아직 컨센서스가 안 된 thesis가 더 높은 알파를 갖는가?" 검증
- **실패 패턴**: Phase 2 신호 후 실패한 케이스의 시장 조건(브레드스, 섹터 RS, 거래량 등)을 자동 기록. 실패율 70%+ 패턴은 필터링 규칙으로 승격되어 위양성을 사전 차단

### 운영 지표 (2026-03-20 기준)

서사 프레임(N-1) 적용 후 데이터 축적 중. N-2 검증 인프라 착수 대기 (3/22~).
최근 2주간 학습 루프 안정화 집중 (#322~#332): thesis 검증 0건 수리, 피드백 루프 단절 보강, 발송 게이트 강화.

| 지표 | 현재 | 목표 (6개월) | 비고 |
|------|------|-------------|------|
| 테스트 | — (102 files) | 유지 | Backend only (Frontend → control-tower) |
| 토론 세션 | 운영 중 | — | 평일 매일 자동 실행 |
| Thesis 총 건수 | 축적 중 | 200건+ | 서사 카테고리 분리 적용 |
| 학습 승격 | 축적 중 | 10건+ | 3회+ 적중 패턴 필요 |
| 실패 패턴 | 축적 중 | 5건+ | N-1e 배포 완료, 데이터 수집 중 |
| 대시보드 | → control-tower 레포 | — | 프론트엔드 분리 완료 |
| 자동화 스케줄 | 10개 launchd 작업 | 안정 운영 | 매일 36회+ 자동 트리거 |

**핵심 추적 질문:** 서사-기술적 교집합이 기술적 단독 대비 적중률을 높이는가? → N-2 홀드아웃 테스트(3/22 이후)에서 검증 예정.

### Fundamental Validation (Minervini SEPA)

Phase 2 종목에 대한 실적 기반 정량 검증 시스템:

- **Non-GAAP EPS 우선**: `eps_surprises.actual_eps`(Non-GAAP) 우선, `quarterly_financials.eps_diluted`(GAAP) 폴백 — 시장이 실제 반응하는 EPS 기준 (#559)

| 등급 | 조건 | 액션 |
|------|------|------|
| **S** | A등급 상위 Top 3 (rankScore) | 개별 종목 심층 리포트 (Discord + Gist) |
| **A** | EPS/매출 YoY >25% + 가속+마진 | 주간 리포트에 포함 + LLM 내러티브 |
| **B** | 필수 2개 충족 | 주간 리포트에 포함 |
| **C** | 필수 1개만 충족 | 기술적으로만 Phase 2 경고 |
| **F** | 미충족 또는 데이터 부족 | 펀더멘탈 미달 표시 |

## 스케줄링 (맥미니 launchd)

모든 자동화는 맥미니 서버에서 macOS launchd로 실행. GitHub Actions는 사용하지 않음.

| 작업 | 스케줄 (KST) | 내용 |
|------|-------------|------|
| ETL Daily | 07:00 화~토 | ETL 6단계 → 토론 → 일간 리포트 → QA 검증 |
| ETL Weekly | 08:00 일 | 분기 재무·비율 갱신 |
| Agent Weekly | 10:00 토 | 주간 리포트 + CEO 리포트 + 주간 검증 |
| QA Weekly | 12:00 토 | 주간 QA 분석 |
| News Collect | 06:00, 18:00 매일 | 뉴스 수집 (2회/일) |
| Strategic Review | 04:00 매일 | 전략 참모 리뷰 → `strategic-briefing.md` 갱신 (매니저 골 정렬 근거) |
| Issue Triage | 09:00 매일 | 미트리아지 이슈 사전 분류 |
| Issue Processor | 10:00~02:00 매 정시 (17회/일) | triaged 이슈 자동 구현 → PR 생성 |
| PR Reviewer | 09:15~02:15 매 :15분 (18회/일) | PR Strategic + Code 리뷰 → 코멘트 게시 |
| Log Cleanup | 09:00 일 | 30일 이상 로그 정리 |

```bash
# 설치/관리 (SSH 원격 가능)
./scripts/launchd/setup-launchd.sh              # 등록
./scripts/launchd/setup-launchd.sh --status     # 상태 확인
./scripts/launchd/setup-launchd.sh --remove     # 해제
```

## Tech Stack

| 영역 | 기술 |
|------|------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript (strict) |
| Package Manager | Yarn (Classic 1.x) |
| AI | Claude Sonnet 4.6, GPT-4o, Gemini 2.5 Flash (멀티 모델 토론) |
| Database | PostgreSQL (Supabase) via Drizzle ORM |
| Testing | Vitest (Backend) |
| Scheduling | macOS launchd (맥미니 서버) |
| Delivery | Discord Webhook + Supabase Storage (HTML) + GitHub Gist (fallback) |
| Search | Brave Search API |
| Automation | Claude Code CLI (Auto Issue Processor, QA) |

## Feature Roadmap

### Core Features (완료)

- [x] **F1** Data Infrastructure — ETL 파이프라인 (Phase, RS, 브레드스, 돌파/노이즈 신호, US10Y/DXY)
- [x] **F2** Agent Core — Claude agentic loop + 16개 도구 + 일간/주간 분리
- [ ] ~~**F3** Industry Intelligence~~ — 폐기. F6 토론 엔진이 시장 분석 역할을 대체
- [x] **F4** Tracking System — 추천 종목 성과 트래킹 + Phase 이탈 감지
- [x] **F5** Report & Delivery — Discord 발송, Gist MD, 리뷰 파이프라인
- [x] **F6** Debate & Evolution — 멀티 모델(GPT-4o/Gemini/Claude) 4명 토론 + thesis 저장 + 학습 루프
- [x] **F7** Fundamental Validation — Minervini SEPA 스코어링 + 전체 종목 확장
- [x] **F8** Report/Debate Archive Dashboard — → control-tower 레포 분리 (#587)
- [x] **F9** Strategic Auto-Review — 매일 시스템 분석 → `strategic-briefing.md` 갱신 (매니저 골 정렬 근거)
- [x] **F10** Corporate Analyst — 종목별 심층 분석 리포트 + 정량 목표주가 산출 (피어 멀티플 + 컨센서스 교차 검증)
- [x] **F11** Insight Briefing Pivot — 추천 시스템 → 관심종목 + 인사이트 브리핑 중심 전환 (KPI: thesis 적중률 + 포착 선행성) (#390)

### Enhancement Phases (완료)

- [x] **Phase A** Learning Loop — 세션 저장, few-shot 주입, 원인 분석, 패턴 승격
- [x] **Phase A+** Signal Validation — 초입 포착 도구 유효성 검증 + 편향 감지 + QA 정상화
- [x] **Phase A++** Weekly Redesign — 주간 리포트 전면 재설계 (도구 주간 집계 + 프롬프트 차별화)
- [x] **Phase N** Narrative Layer — 수요-공급-병목 서사 프레임 + thesis 카테고리 분리 + N+1 병목 예측 + 합의도 추적 + 실패 패턴 축적 + 병목 체인 추적 (N-1, Wave 2a/2b 완료)
- [x] **Sector Lag Pattern** — 섹터 간 Phase 전이 시차 축적 + 선행 경보 → 주간 에이전트 연동
- [x] **일간 품질 검증** — Claude Code CLI 기반 리포트 QA + 조건부 발송 게이트 + bull-bias 감지
- [x] **자율 이슈 처리** — Auto Issue Processor: GitHub 이슈 → Claude Code CLI 자동 처리 → PR 생성 (10단계 프로토콜: plan.md 작성 → 골 정렬 검증 → 구현 → 셀프 리뷰 → PR)
- [x] **자동 PR 리뷰** — Auto PR Reviewer: 이슈 프로세서 생성 PR → Strategic + Code 병렬 리뷰 → GitHub 코멘트 자동 게시 (#364)
- [x] **LATE_BULL 진입 감쇠** — LATE_BULL 레짐 진입 조건 강화 (RS 70+, SEPA A+, Phase 2 지속 5일+) — 과열 후기 구조적 손실 차단 (#508)

### Next (진행 예정)

- [x] **멀티 모델 토론** — GPT-4o(매크로)/Gemini(테크)/Claude(지정학·심리) 확증편향 구조적 완화 + Claude 자동 폴백
- [ ] **Phase N-2** 검증 인프라 — 홀드아웃 테스트 + 위양성 비용 리포트 (데이터 축적 대기, 3/22~)
- [ ] **Phase B** Data Differentiation — 섹터 자금 흐름, 거래량 이상 감지
- [ ] **Phase C** Output Quality — 리포트 후처리 검증, 시각화

자세한 로드맵: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Key Directories

```
src/
├── agent/
│   ├── agentLoop.ts         # 메인 에이전트 루프
│   ├── run-daily-agent.ts   # 일간 에이전트 실행
│   ├── run-weekly-agent.ts  # 주간 에이전트 실행
│   └── reviewAgent.ts       # 리포트 품질 검증 + 조건부 발송
├── debate/                  # 멀티 모델 토론 엔진 + 학습 루프
│   ├── debateEngine.ts      # 3라운드 토론 오케스트레이터
│   ├── llm/                 # LLM Provider 추상화 (Anthropic/OpenAI/Gemini + 폴백)
│   ├── causalAnalyzer.ts    # 원인 분석 (왜 맞았는지/틀렸는지)
│   ├── thesisVerifier.ts    # thesis 자동 검증
│   ├── sessionStore.ts      # 세션 저장 + 유사 세션 검색
│   ├── memoryLoader.ts      # 학습 → 프롬프트 주입
│   └── narrativeChainService.ts  # 병목 체인 추적
├── corporate-analyst/       # 기업 애널리스트 (종목 심층 분석 + 정량 목표주가)
├── fundamental/             # SEPA 펀더멘탈 검증
├── tools/                   # 에이전트 도구 (18개 + 내부 유틸 2개)
├── issue-processor/         # 자율 이슈 처리 (Claude Code CLI)
├── pr-reviewer/             # 자동 PR 리뷰 (Strategic + Code 병렬 리뷰어)
├── etl/                     # 데이터 파이프라인
├── lib/                     # 유틸리티 (스코어링, 분석, 시차 통계)
└── db/schema/               # Drizzle ORM 스키마


docs/
├── ROADMAP.md               # 전체 로드맵
└── features/                # 기능별 스펙/결정/플랜
```

## License

Private
