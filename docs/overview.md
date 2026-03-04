# Market Analyst Agent — Project Overview

**Status:** Active (MVP 운영 중)
**Created:** 2026-03-04
**Last Updated:** 2026-03-04

---

## Vision

매일 아침 Claude Agent가 자율적으로 시장을 탐색하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 카탈리스트 분석까지 포함한 리포트를 Discord로 발송하는 시스템.

### 과거 사례로 보는 목표

| 연도 | 주도섹터 | 주도주 | 배경 |
|------|----------|--------|------|
| 2024 | AI 소프트웨어 | PLTR, NOW | AI 엔터프라이즈 도입 가속 |
| 2025 | 메모리 반도체 | SK하이닉스, MU | HBM 수요 폭발 |
| 2026 | 광통신 | CIEN, LITE | AI 데이터센터 인프라 확장 |

**이런 흐름을 Agent가 데이터 + 산업 동향을 종합해서 포착하는 것이 목표.**

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    market-analyst                          │
│                                                            │
│  ┌────────────┐    ┌─────────────┐    ┌───────────────┐  │
│  │    ETL     │    │    Agent    │    │   Delivery    │  │
│  │            │    │    Core     │    │               │  │
│  │ Stock Phase│    │             │    │ Discord 발송  │  │
│  │ Sector RS  │───▶│ Claude API  │───▶│ Gist 첨부     │  │
│  │ Industry RS│    │ + Tool Use  │    │ 일간/주간 분리 │  │
│  │ Validation │    │             │    │               │  │
│  └────────────┘    │      ▲      │    └───────────────┘  │
│                    │      │      │                         │
│  ┌────────────┐    │    도구들    │    ┌───────────────┐  │
│  │  Catalyst  │    │             │    │  Report Log   │  │
│  │  Search    │───▶│             │◀──│               │  │
│  │            │    └─────────────┘    │ JSON 파일 기반 │  │
│  │ Brave API  │                       │ 이력 관리      │  │
│  └────────────┘                       └───────────────┘  │
│                                                            │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                   Shared DB (Supabase)                      │
│             screener 기존 테이블 + 신규 테이블               │
└──────────────────────────────────────────────────────────┘
```

### CI/CD Pipeline (GitHub Actions)

```
일간 (월~금, UTC 00:00 = KST 09:00):
  build-stock-phases → build-sector-rs ──┐
                    └→ build-industry-rs ─┤→ validate → run-daily-agent
                                          │
주간 (토, UTC 01:00 = KST 10:00):
  run-weekly-agent (금요일 데이터 기반)
```

---

## Feature Map

| # | Feature | 상태 | 핵심 |
|---|---------|------|------|
| F1 | Data Infrastructure | **완료** | 섹터/산업 RS, Weinstein Phase 판별, 브레드스 |
| F2 | Agent Core | **완료** | Claude agentic loop, 10개 도구, 일간/주간 분리 |
| F3 | Industry Intelligence | 미착수 | FMP 뉴스, 웹 검색, 테마 연결/예측 |
| F4 | Tracking System | 미착수 | Agent 전용 워치리스트, Phase 전환 감지 |
| F5 | Report & Delivery | **완료** | Discord 발송, Gist MD 첨부, 일간/주간 스케줄 |

---

## Agent Tools (10개)

| 도구 | 일간 | 주간 | 설명 |
|------|:----:|:----:|------|
| `getIndexReturns` | O | O | S&P, NASDAQ, DOW, Russell, VIX + 공포탐욕지수 |
| `getMarketBreadth` | O | O | Phase 분포, Phase 2 비율, A/D ratio |
| `getLeadingSectors` | O | O | RS 상위 섹터/업종, 가속도, 브레드스 |
| `getPhase2Stocks` | | O | Phase 2 종목 (RS 60+), 1→2 전환 우선 |
| `getUnusualStocks` | O | | 복합 조건 특이종목 (등락률+거래량+Phase) |
| `getStockDetail` | O | O | 개별 종목 상세 (Phase, RS, MA, 52주) |
| `searchCatalyst` | O | O | Brave Search 뉴스 검색 + 카탈리스트 |
| `sendDiscordReport` | O | O | Discord 메시지 + Gist MD 첨부 |
| `readReportHistory` | | O | 과거 리포트 이력 조회 (중복 방지) |
| `saveReportLog` | O | O | 리포트 결과 JSON 저장 |

---

## Implementation Progress

```
Phase 1 — MVP ✅ 완료
  F1 (데이터 인프라) → F2 (Agent 코어) → F5 (리포트 발송)
  결과: 일간/주간 시장 분석 리포트가 매일 Discord로 발송됨

Phase 2 — 추적 (예정)
  F4 (워치리스트 + 이력)
  결과: 발견 종목을 지속 추적, Phase 전환 감지

Phase 3 — 산업 인텔리전스 (예정)
  F3 (뉴스 + 웹 검색 + 테마 예측)
  결과: "왜 오르는가?" + "다음 수혜 섹터" 분석 추가
```

---

## Key Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| 프로젝트 구조 | 별도 레포 (`market-analyst`) | 관심사 완전 분리, 독립 CI/CD |
| DB 공유 | screener와 같은 Supabase | 기존 가격/재무 데이터 재활용, 중복 없음 |
| 실행 환경 | Claude API + Tool Use (Node.js) | 완전한 제어권, 도구 설계 자유 |
| 모델 | Claude Opus 4.6 | 시장 분석 품질 최우선 |
| Phase 기준 | Weinstein Stage Analysis (8개 조건) | 체계적 프레임워크, 정량 판별 가능 |
| 섹터 시그널 | RS 가속도 + 브레드스 | 다수 종목 동반 상승 확인 |
| 카탈리스트 | Brave Search API | 뉴스 검색 비용 합리적, 빠른 결과 |
| 리포트 분리 | 일간(시장 온도) / 주간(종목 발굴) | 목적별 최적화 |
| 딜리버리 | Discord Webhook + Gist | 모바일 즉시 확인, MD 파일 완전 렌더링 |
| 리포트 이력 | JSON 파일 (`data/reports/`) | DB 불필요, 간단하고 충분 |
| 스케줄링 | GitHub Actions cron | 무료 티어, 인프라 관리 불필요 |

---

## External Dependencies

| 의존성 | 용도 | 비용 |
|--------|------|------|
| Supabase (PostgreSQL) | 공유 DB — screener 기존 테이블 + 신규 테이블 | 기존 플랜 |
| Claude API (Anthropic) | Agent 추론 엔진 (Opus 4.6) | ~$0.3-0.5/일 |
| Discord Webhook | 리포트 발송 (일간/주간/에러 채널) | 무료 |
| Brave Search API | 카탈리스트 뉴스 검색 | 무료 티어 (월 2,000건) |
| GitHub Actions | 스케줄링 (일간 ETL+Agent, 주간 Agent) | 무료 티어 |
| GitHub Gist | MD 리포트 첨부 | 무료 |

---

## Shared DB Strategy

```
screener DB (기존 테이블 — 읽기 전용)
├── symbols               → 종목 메타데이터
├── daily_prices           → 일별 가격 + RS
├── daily_ma               → 이동평균 + 거래량 MA
├── daily_ratios           → 일별 밸류에이션
├── quarterly_financials   → 분기 재무
├── daily_breakout_signals → 돌파 시그널
└── daily_noise_signals    → 노이즈 필터

market-analyst DB (신규 테이블 — 읽기/쓰기)
├── stock_phases       → 종목별 Weinstein Phase 판별 결과 ✅
├── sector_rs_daily    → 섹터별 RS 점수/가속도/브레드스 ✅
├── industry_rs_daily  → 산업별 RS 점수/가속도/브레드스 ✅
├── agent_watchlist         → Agent 전용 워치리스트 (F4 예정)
├── agent_watchlist_history → 워치리스트 변동 이력 (F4 예정)
└── sector_themes           → 섹터 테마/내러티브 추적 (F3 예정)
```

---

## Project Structure

```
market-analyst/
├── src/
│   ├── agent/              # F2: Agent Core
│   │   ├── agentLoop.ts        # 메인 에이전트 루프
│   │   ├── systemPrompt.ts     # 일간/주간 시스템 프롬프트
│   │   ├── run-daily-agent.ts  # 일간 에이전트 엔트리포인트
│   │   ├── run-weekly-agent.ts # 주간 에이전트 엔트리포인트
│   │   ├── discord.ts          # Discord Webhook 발송
│   │   ├── gist.ts             # GitHub Gist 업로드
│   │   ├── reportLog.ts        # 리포트 이력 JSON I/O
│   │   ├── logger.ts           # 구조화된 로깅
│   │   └── tools/              # 에이전트 도구 (10개)
│   ├── etl/                # F1: ETL Pipeline
│   │   ├── jobs/               # ETL 실행 파일 (4개)
│   │   └── utils/              # Phase 판별, RS 계산, 유틸리티
│   ├── db/                 # Drizzle ORM 스키마
│   └── types/              # 공유 타입 정의
├── __tests__/              # Vitest 테스트
├── data/reports/           # 리포트 이력 JSON
├── docs/features/          # 기능별 스펙/결정/플랜
├── .github/workflows/      # CI/CD (일간 ETL, 주간 Agent)
└── prompts/                # (reserved)
```
