# Market Analyst Agent

Claude Agent가 자율적으로 시장을 분석하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 카탈리스트 분석을 포함한 리포트를 Discord로 발송하는 시스템.

## How It Works

```
1. ETL 파이프라인이 매일 장 마감 후 실행
   → Weinstein Phase 판별, 섹터/산업 RS 계산, 브레드스 분석

2. Claude Agent가 도구를 사용해 자율적으로 시장 분석
   → 주도섹터 발굴, 특이종목 스크리닝, Brave Search 카탈리스트 검색

3. 분석 결과를 Discord로 발송
   → 일간: 시장 온도 + 특이종목 브리핑
   → 주간: Phase 2 주도주 심층 분석
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
DATABASE_URL=postgresql://...          # Supabase 연결
ANTHROPIC_API_KEY=sk-ant-...           # Claude API
DISCORD_WEBHOOK_URL=https://...        # 일간 리포트 채널
DISCORD_WEEKLY_WEBHOOK_URL=https://... # 주간 리포트 채널
DISCORD_ERROR_WEBHOOK_URL=https://...  # 에러 알림 채널 (optional)
BRAVE_API_KEY=BSA...                   # 카탈리스트 뉴스 검색
GITHUB_TOKEN=gho_...                   # Gist MD 첨부
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

# 테스트
npm test                    # 전체 테스트
npm run test:watch          # 워치 모드
npm run typecheck           # 타입 체크

# DB
npm run db:generate         # 마이그레이션 생성
npm run db:push             # 스키마 적용
```

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     ETL      │    │    Agent     │    │   Delivery   │
│              │    │              │    │              │
│ Stock Phases │───▶│ Claude Opus  │───▶│   Discord    │
│ Sector RS    │    │ + 10 Tools   │    │   + Gist     │
│ Industry RS  │    │              │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
        │                  │                    │
        └──────────────────┴────────────────────┘
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

## CI/CD (GitHub Actions)

| Workflow | Schedule | 내용 |
|----------|----------|------|
| `etl-daily.yml` | 월~금 UTC 00:00 (KST 09:00) | ETL 4단계 → 일간 에이전트 |
| `agent-weekly.yml` | 토 UTC 01:00 (KST 10:00) | 주간 에이전트 |

## Tech Stack

| 영역 | 기술 |
|------|------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript (strict) |
| AI | Claude Opus 4.6 (Anthropic SDK) |
| Database | PostgreSQL (Supabase) via Drizzle ORM |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Delivery | Discord Webhook + GitHub Gist |
| Search | Brave Search API |

## Feature Roadmap

- [x] **F1** Data Infrastructure — ETL 파이프라인 (Phase, RS, 브레드스)
- [x] **F2** Agent Core — Claude agentic loop + 도구 + 일간/주간 분리
- [x] **F5** Report & Delivery — Discord 발송, Gist MD 첨부
- [ ] **F4** Tracking System — 워치리스트, Phase 전환 감지
- [ ] **F3** Industry Intelligence — 뉴스 분석, 테마 연결, 수혜 섹터 예측

## Documentation

기능별 스펙과 결정 문서는 `docs/features/` 아래에 정리:

```
docs/features/
├── data-infra/           # F1 스펙, 결정, 플랜
├── agent-core/           # F2 스펙, 결정, 플랜
└── report-split-catalyst/ # 리포트 분리 + 카탈리스트 스펙
```

## License

Private
