# Market Analyst Agent

Claude Agent가 자율적으로 시장을 분석하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 멀티 애널리스트 토론 + 펀더멘탈 검증 + 학습 루프를 통해 **시간이 지날수록 똑똑해지는** 시장 분석 시스템.

> **Backend** 153 TS files · **Frontend** 145 TS/TSX files · **Tests** 1,420 · **Open Issues** 10

## How It Works

```
1. ETL 파이프라인 (매일 장 마감 후)
   → Weinstein Phase 판별, 섹터/산업 RS 계산, 브레드스 분석

2. 멀티 모델 애널리스트 토론 (매일 22:00 UTC)
   → 매크로(GPT-4o)/테크(Gemini)/지정학(Claude)/심리(Claude) 4명이 3라운드 토론
   → 멀티 모델 다양성으로 확증편향 구조적 완화 + 외부 API 장애 시 Claude 자동 폴백
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

6. 기업 애널리스트 (추천 종목별 자동 생성)
   → 피어 멀티플(P/E·EV/EBITDA·P/S) 가중 평균 기반 정량 목표주가 산출
   → 월가 컨센서스 교차 검증 (ALIGNED/DIVERGENT/LARGE_DIVERGENT)
   → LLM은 정량 결과를 해석만 — 숫자를 만들어내지 않음
   → 어닝콜 핵심 발언, 포워드 EPS, 피어 비교 등 Seeking Alpha 수준 리포트

7. 에이전트 리포트
   → 일간: 시장 온도 + 특이종목 브리핑 (조건부 발송)
   → 주간: Phase 2 주도주 심층 분석 + 펀더멘탈 검증 (SEPA)
   → S등급(Top 3): 개별 종목 심층 리포트 발행

8. 자율 운영
   → Auto Issue Processor: GitHub 이슈 → Claude Code CLI 자동 처리 → PR 생성
   → 맥미니 서버 launchd 기반 스케줄링
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
GOOGLE_GENERATIVE_AI_API_KEY=AI...          # Gemini 2.0 Flash (테크 애널리스트)
DISCORD_WEBHOOK_URL=https://...             # 일간 리포트 채널
DISCORD_WEEKLY_WEBHOOK_URL=https://...      # 주간 리포트 채널
DISCORD_STOCK_REPORT_WEBHOOK_URL=https://...  # S등급 종목 리포트 채널
DISCORD_ERROR_WEBHOOK_URL=https://...       # 에러 알림 채널 (optional)
BRAVE_API_KEY=BSA...                        # 카탈리스트 뉴스 검색
GITHUB_TOKEN=gho_...                        # Gist MD 첨부
```

### Run

```bash
# ETL 파이프라인
yarn etl:stock-phases       # Weinstein Phase 판별
yarn etl:sector-rs          # 섹터 RS 계산
yarn etl:industry-rs        # 산업 RS 계산
yarn etl:validate           # 데이터 검증

# Agent 실행
yarn agent:daily            # 일간 시장 브리핑
yarn agent:weekly           # 주간 종목 분석
yarn agent:debate           # 애널리스트 토론 (매크로/테크/지정학/심리)
yarn agent:issue-processor  # 자율 이슈 처리 (Claude Code CLI)

# Frontend
yarn fe:dev                 # 개발 서버
yarn fe:build               # 프로덕션 빌드
yarn fe:test                # 프론트엔드 테스트

# 테스트
yarn test                   # 전체 테스트 (1,199 tests)
yarn test:watch             # 워치 모드
yarn typecheck              # 타입 체크

# DB
yarn db:generate            # 마이그레이션 생성
yarn db:push                # 스키마 적용
```

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     ETL      │    │Multi-Model   │    │    Agent     │
│              │    │   Debate     │    │              │
│ Stock Phases │───▶│GPT-4o/Gemini│───▶│Claude Sonnet │
│ Sector RS    │    │/Claude 4명   │    │ + 16 Tools   │
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
                    │ Discord+Gist │
                    └──────┬───────┘
                           │
               ┌───────────┼───────────┐
               │           │           │
        ┌──────▼──┐  ┌─────▼────┐  ┌──▼───────┐
        │Supabase │  │ Frontend │  │ Auto     │
        │   (DB)  │  │Dashboard │  │Issue Proc│
        └─────────┘  └──────────┘  └──────────┘
```

### Agent Tools

| 도구 | 일간 | 주간 | 설명 |
|------|:----:|:----:|------|
| `getIndexReturns` | O | O | 4대 지수 + VIX + 공포탐욕지수 (주간: 누적 + 고저 위치) |
| `getMarketBreadth` | O | O | Phase 분포, Phase 2 비율, A/D ratio (주간: 5일 추이 + Phase 1→2 전환) |
| `getLeadingSectors` | O | O | RS 상위 섹터/업종 (주간: 전주 대비 순위 변동 + 신규 진입/이탈) |
| `getPhase2Stocks` | | O | Phase 2 초입 종목 리스트 (RS 필터링) |
| `getPhase1LateStocks` | O | O | Phase 1 후기 종목 — Phase 2 진입 1~3개월 선행 포착 |
| `getRisingRS` | O | O | RS 30~60 상승 가속 종목 — 초기 모멘텀 포착 |
| `getFundamentalAcceleration` | | O | EPS/매출 성장 가속 종목 (Phase 1~2 대상) |
| `getUnusualStocks` | O | | 복합 조건 특이종목 스크리닝 (등락률·거래량·Phase 전환) |
| `getStockDetail` | O | O | 개별 종목 상세 분석 (Phase, RS, MA, 섹터 컨텍스트) |
| `searchCatalyst` | O | O | Brave Search 뉴스 기반 카탈리스트 |
| `readReportHistory` | | O | 과거 리포트 이력 (중복 방지) |
| `readRecommendationPerformance` | | O | 추천 성과 트래킹 (주간: 신규/종료/Phase 이탈 집계) |
| `readActiveTheses` | O | O | 현재 ACTIVE thesis 목록 (토론 엔진 생성) |
| `readLearnings` | O | O | 에이전트 장기 기억 (검증된 원칙 + 경계 패턴) |
| `saveRecommendations` | | O | 추천 종목 DB 저장 (팩터 스냅샷 포함) |
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
| Thesis Store | `thesisStore.ts` | thesis 저장, 만료, 통계, 카테고리별 관리 |
| Thesis Verifier | `thesisVerifier.ts` | LLM 기반 자동 검증 |
| Causal Analyzer | `causalAnalyzer.ts` | 검증 결과 원인 분석, 패턴 추출 |
| Session Store | `sessionStore.ts` | 토론 세션 저장, 유사 세션 검색 |
| Memory Loader | `memoryLoader.ts` | 학습 + 검증 결과 프롬프트 주입 |
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

### 운영 지표 (2026-03-11 기준)

서사 프레임(N-1) 적용 후 데이터 축적 중. N-2 검증 인프라 착수 대기.

| 지표 | 현재 | 목표 (6개월) | 비고 |
|------|------|-------------|------|
| 테스트 | 1,420 (97 files) | 유지 | Backend + Frontend |
| 토론 세션 | 운영 중 | — | 평일 매일 자동 실행 |
| Thesis 총 건수 | 축적 중 | 200건+ | 서사 카테고리 분리 적용 |
| 학습 승격 | 축적 중 | 10건+ | 3회+ 적중 패턴 필요 |
| 실패 패턴 | 축적 중 | 5건+ | N-1e 배포 완료, 데이터 수집 중 |
| 프론트엔드 | 리포트/토론 아카이브 | 대시보드 확장 | Next.js 16 + Supabase Auth |

**핵심 추적 질문:** 서사-기술적 교집합이 기술적 단독 대비 적중률을 높이는가? → N-2 홀드아웃 테스트(3/22 이후)에서 검증 예정.

### Fundamental Validation (Minervini SEPA)

Phase 2 종목에 대한 실적 기반 정량 검증 시스템:

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
| ETL Daily | 08:30 화~토 | ETL 4단계 → 일간 에이전트 → 리포트 검증 |
| Debate Daily | 07:00 화~금 | 애널리스트 토론 → thesis 저장 |
| Agent Weekly | 10:00 토 | 주간 에이전트 + 펀더멘탈 검증 |
| QA Weekly | 12:00 토 | 주간 QA 분석 |
| News Collect | 00/06/12/18:00 매일 | 뉴스 수집 |
| Issue Processor | 10/12/14/16:00 평일 | GitHub 이슈 자동 처리 → PR 생성 |
| Log Cleanup | 09:00 일 | 오래된 로그 정리 |

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
| AI | Claude Sonnet 4.6, GPT-4o, Gemini 2.0 Flash (멀티 모델 토론) |
| Database | PostgreSQL (Supabase) via Drizzle ORM |
| Frontend | Next.js 16 (App Router), Tailwind CSS v4, shadcn/ui, Supabase SSR |
| Auth | Supabase Auth (Magic Link) |
| Testing | Vitest (Backend + Frontend), Playwright (E2E) |
| Scheduling | macOS launchd (맥미니 서버) |
| Delivery | Discord Webhook + GitHub Gist |
| Search | Brave Search API |
| Automation | Claude Code CLI (Auto Issue Processor, QA) |

## Feature Roadmap

### Core Features (완료)

- [x] **F1** Data Infrastructure — ETL 파이프라인 (Phase, RS, 브레드스, 돌파/노이즈 신호)
- [x] **F2** Agent Core — Claude agentic loop + 16개 도구 + 일간/주간 분리
- [ ] ~~**F3** Industry Intelligence~~ — 폐기. F6 토론 엔진이 시장 분석 역할을 대체
- [x] **F4** Tracking System — 추천 종목 성과 트래킹 + Phase 이탈 감지
- [x] **F5** Report & Delivery — Discord 발송, Gist MD, 리뷰 파이프라인
- [x] **F6** Debate & Evolution — 멀티 모델(GPT-4o/Gemini/Claude) 4명 토론 + thesis 저장 + 학습 루프
- [x] **F7** Fundamental Validation — Minervini SEPA 스코어링 + 전체 종목 확장
- [x] **F8** Report/Debate Archive Dashboard — Next.js 16 + Supabase Auth + 리포트/토론 아카이브 UI
- [x] **F9** Strategic Auto-Review — Claude Code CLI 기반 전략 참모 자동 리뷰
- [x] **F10** Corporate Analyst — 종목별 심층 분석 리포트 + 정량 목표주가 산출 (피어 멀티플 + 컨센서스 교차 검증)

### Enhancement Phases (완료)

- [x] **Phase A** Learning Loop — 세션 저장, few-shot 주입, 원인 분석, 패턴 승격
- [x] **Phase A+** Signal Validation — 초입 포착 도구 유효성 검증 + 편향 감지 + QA 정상화
- [x] **Phase A++** Weekly Redesign — 주간 리포트 전면 재설계 (도구 주간 집계 + 프롬프트 차별화)
- [x] **Phase N** Narrative Layer — 수요-공급-병목 서사 프레임 + thesis 카테고리 분리 + N+1 병목 예측 + 합의도 추적 + 실패 패턴 축적 + 병목 체인 추적 (N-1, Wave 2a/2b 완료)
- [x] **Sector Lag Pattern** — 섹터 간 Phase 전이 시차 축적 + 선행 경보 → 주간 에이전트 연동
- [x] **일간 품질 검증** — Claude Code CLI 기반 리포트 QA + 조건부 발송 게이트 + bull-bias 감지
- [x] **자율 이슈 처리** — Auto Issue Processor: GitHub 이슈 → Claude Code CLI 자동 처리 → PR 생성

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
│   ├── debate/              # 멀티 모델 토론 엔진 + 학습 루프
│   │   ├── debateEngine.ts  # 3라운드 토론 오케스트레이터
│   │   ├── llm/             # LLM Provider 추상화 (Anthropic/OpenAI/Gemini + 폴백)
│   │   ├── causalAnalyzer.ts # 원인 분석 (왜 맞았는지/틀렸는지)
│   │   ├── thesisVerifier.ts # thesis 자동 검증
│   │   ├── sessionStore.ts  # 세션 저장 + 유사 세션 검색
│   │   ├── memoryLoader.ts  # 학습 → 프롬프트 주입
│   │   └── narrativeChainService.ts  # 병목 체인 추적
│   ├── corporateAnalyst/    # 기업 애널리스트 (종목 심층 분석 + 정량 목표주가)
│   ├── fundamental/         # SEPA 펀더멘탈 검증
│   ├── tools/               # 에이전트 도구 (16개 + 내부 유틸 1개)
│   └── reviewAgent.ts       # 리포트 품질 검증 + 조건부 발송
├── issue-processor/         # 자율 이슈 처리 (Claude Code CLI)
├── etl/                     # 데이터 파이프라인
├── lib/                     # 유틸리티 (스코어링, 분석, 시차 통계)
└── db/schema/               # Drizzle ORM 스키마

frontend/
├── src/
│   ├── app/                 # Next.js App Router (라우트만)
│   ├── features/            # 피쳐 기반 모듈 (auth, reports, debates)
│   └── shared/              # 공통 컴포넌트, 훅, 유틸
└── e2e/                     # Playwright E2E 테스트

docs/
├── ROADMAP.md               # 전체 로드맵
└── features/                # 기능별 스펙/결정/플랜
```

## License

Private
