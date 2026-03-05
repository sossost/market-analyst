# Market Analyst Agent

Claude Agent가 자율적으로 시장을 분석하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 펀더멘탈 검증 + 장관 토론을 거쳐 리포트를 Discord로 발송하는 시스템.

## How It Works

```
1. ETL 파이프라인이 매일 장 마감 후 실행
   → Weinstein Phase 판별, 섹터/산업 RS 계산, 브레드스 분석

2. 장관 토론 (매일 22:00 UTC)
   → 매크로/테크/지정학/심리 4명이 3라운드 토론
   → 모더레이터가 thesis 구조화 → DB 저장

3. Claude Agent가 도구를 사용해 자율적으로 시장 분석
   → 주도섹터 발굴, 특이종목 스크리닝, 카탈리스트 검색
   → 일간: 시장 온도 + 특이종목 브리핑
   → 주간: Phase 2 주도주 심층 분석 + 펀더멘탈 검증

4. 펀더멘탈 검증 (Minervini SEPA)
   → Phase 2 종목의 실적 데이터 정량 스코어링 (S/A/B/C/F)
   → S등급(Top 3): 개별 종목 심층 리포트 발행
   → LLM 페르소나가 투자 내러티브 생성
```

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL (Supabase) — screener DB와 공유
- API Keys: Anthropic, Discord Webhook, Brave Search, GitHub Token

### Setup

```bash
git clone https://github.com/jang-yunsu/market-analyst.git
cd market-analyst
npm ci
cp .env.example .env  # 환경변수 설정
```

### Environment Variables

```env
DATABASE_URL=postgresql://...               # Supabase 연결
ANTHROPIC_API_KEY=sk-ant-...                # Claude API
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
npm run etl:stock-phases    # Weinstein Phase 판별
npm run etl:sector-rs       # 섹터 RS 계산
npm run etl:industry-rs     # 산업 RS 계산
npm run etl:validate        # 데이터 검증

# Agent 실행
npm run agent:daily         # 일간 시장 브리핑
npm run agent:weekly        # 주간 종목 분석
npm run agent:debate        # 장관 토론 (매크로/테크/지정학/심리)

# 테스트
npm test                    # 전체 테스트 (307 tests)
npm run test:watch          # 워치 모드
npm run typecheck           # 타입 체크

# DB
npm run db:generate         # 마이그레이션 생성
npm run db:push             # 스키마 적용
```

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     ETL      │    │   Debate     │    │    Agent     │
│              │    │              │    │              │
│ Stock Phases │───▶│ 4 Ministers  │───▶│ Claude Opus  │
│ Sector RS    │    │ 3-Round Talk │    │ + 12 Tools   │
│ Industry RS  │    │ + Moderator  │    │ + Fundamental│
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       │            ┌──────▼───────┐           │
       └───────────▶│   Delivery   │◀──────────┘
                    │  Discord     │
                    │  + Gist      │
                    └──────┬───────┘
                           │
                    Supabase (PostgreSQL)
```

### Agent Tools

| 도구 | 일간 | 주간 | 설명 |
|------|:----:|:----:|------|
| `getIndexReturns` | O | O | 4대 지수 + VIX + 공포탐욕지수 |
| `getMarketBreadth` | O | O | Phase 분포, Phase 2 비율, A/D ratio |
| `getLeadingSectors` | O | O | RS 상위 섹터/업종 + 가속도 + 브레드스 |
| `getPhase2Stocks` | | O | Phase 2 종목 리스트 (RS 60+) |
| `getUnusualStocks` | O | | 복합 조건 특이종목 스크리닝 |
| `getStockDetail` | O | O | 개별 종목 상세 분석 |
| `searchCatalyst` | O | O | Brave Search 뉴스 기반 카탈리스트 |
| `sendDiscordReport` | O | O | Discord + Gist 리포트 발송 |
| `readReportHistory` | | O | 과거 리포트 이력 (중복 방지) |
| `saveReportLog` | O | O | 리포트 결과 저장 |
| `saveRecommendations` | | O | 추천 종목 DB 저장 |
| `readRecommendationPerformance` | | O | 추천 성과 트래킹 |

### Fundamental Validation (Minervini SEPA)

Phase 2 종목에 대한 실적 기반 정량 검증 시스템:

| 등급 | 조건 | 액션 |
|------|------|------|
| **S** | A등급 상위 Top 3 (rankScore) | 개별 종목 심층 리포트 (Discord + Gist) |
| **A** | EPS/매출 YoY >25% + 가속+마진 | 주간 리포트에 포함 + LLM 내러티브 |
| **B** | 필수 2개 충족 | 주간 리포트에 포함 |
| **C** | 필수 1개만 충족 | 기술적으로만 Phase 2 경고 |
| **F** | 미충족 또는 데이터 부족 | 펀더멘탈 미달 표시 |

## CI/CD (GitHub Actions)

| Workflow | Schedule | 내용 |
|----------|----------|------|
| `etl-daily.yml` | 월~금 UTC 00:00 (KST 09:00) | ETL 4단계 → 일간 에이전트 |
| `agent-weekly.yml` | 토 UTC 01:00 (KST 10:00) | 주간 에이전트 |
| `debate-daily.yml` | 월~금 UTC 22:00 (KST 07:00) | 장관 토론 → thesis 저장 |
| `agent-rerun.yml` | 수동 트리거 | 에이전트만 재실행 (ETL 생략) |

## Tech Stack

| 영역 | 기술 |
|------|------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript (strict) |
| AI | Claude Opus 4.6 + Sonnet (Anthropic SDK) |
| Database | PostgreSQL (Supabase) via Drizzle ORM |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Delivery | Discord Webhook + GitHub Gist |
| Search | Brave Search API |

## Feature Roadmap

- [x] **F1** Data Infrastructure — ETL 파이프라인 (Phase, RS, 브레드스)
- [x] **F2** Agent Core — Claude agentic loop + 도구 + 일간/주간 분리
- [x] **F4** Tracking System — 추천 종목 성과 트래킹 + Phase 이탈 감지
- [x] **F5** Report & Delivery — Discord 발송, Gist MD, 리뷰 파이프라인
- [x] **F6** Debate & Evolution — 장관 4명 토론 + thesis 저장
- [x] **F7** Fundamental Validation — Minervini SEPA 스코어링 + S등급 리포트

## Documentation

기능별 스펙과 결정 문서는 `docs/features/` 아래에 정리:

```
docs/features/
├── data-infra/              # F1 스펙, 결정, 플랜
├── agent-core/              # F2 스펙, 결정, 플랜
├── report-delivery/         # F5 리포트 분리 + 카탈리스트
├── report-split-catalyst/   # 리포트 분리 스펙
├── tracking/                # F4 추천 종목 트래킹
├── debate-evolution/        # F6 장관 토론 시스템
├── fundamental-validation/  # F7 펀더멘탈 검증 (SEPA)
└── industry-intel/          # F3 산업 인텔리전스 (미착수)
```

## License

Private
