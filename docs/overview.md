# Market Analyst Agent — Project Overview

**Status:** Draft
**Created:** 2026-03-04

---

## Vision

매일 아침 Claude Agent가 자율적으로 시장을 탐색하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 산업 테마 연결 + 다음 수혜 섹터 예측까지 포함한 리포트를 슬랙으로 발송하는 시스템.

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
┌─────────────────────────────────────────────────────┐
│                  market-analyst                       │
│                                                       │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │   ETL    │    │  Agent   │    │   Delivery   │   │
│  │ (신규)   │    │  (Core)  │    │   (Slack)    │   │
│  │          │    │          │    │              │   │
│  │ 섹터 RS  │───▶│ Claude   │───▶│ 리포트 포맷  │   │
│  │ Phase    │    │ API +    │    │ 슬랙 발송    │   │
│  │ 브레드스  │    │ Tool Use │    │              │   │
│  └──────────┘    │          │    └──────────────┘   │
│                  │    ▲     │                        │
│  ┌──────────┐    │    │     │    ┌──────────────┐   │
│  │ Industry │    │  도구들   │    │  Tracking    │   │
│  │  Intel   │───▶│          │◀──│   System     │   │
│  │          │    └──────────┘    │              │   │
│  │ FMP 뉴스 │                    │ 워치리스트    │   │
│  │ 웹 검색  │                    │ 이력 관리     │   │
│  └──────────┘                    └──────────────┘   │
│                                                       │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                  Shared DB (Supabase)                  │
│            screener 기존 테이블 + 신규 테이블           │
└─────────────────────────────────────────────────────┘
```

---

## Feature Map

| # | Feature | 디렉토리 | 핵심 |
|---|---------|----------|------|
| F1 | Data Infrastructure | `data-infra` | 섹터 RS 엔진, Weinstein Phase 판별, 브레드스 |
| F2 | Agent Core | `agent-core` | Claude agentic loop, 도구, 시스템 프롬프트 |
| F3 | Industry Intelligence | `industry-intel` | FMP 뉴스, 웹 검색, 테마 연결/예측 |
| F4 | Tracking System | `tracking` | Agent 전용 워치리스트, 이력, Phase 전환 감지 |
| F5 | Report & Delivery | `report-delivery` | 슬랙 리포트 포맷, 스케줄링 |

---

## Implementation Order

```
Phase 1 — MVP (최소 동작하는 리포트)
  F1 (데이터 인프라) → F2 (Agent 코어) → F5 (슬랙 리포트)
  결과: 섹터 RS/Phase 기반 분석 리포트가 매일 슬랙으로 발송됨

Phase 2 — 추적
  F4 (워치리스트 + 이력)
  결과: 발견 종목을 지속 추적, Phase 전환 감지

Phase 3 — 산업 인텔리전스
  F3 (뉴스 + 웹 검색 + 테마 예측)
  결과: "왜 오르는가?" + "다음 수혜 섹터" 분석 추가
```

---

## Key Decisions (Project Level)

| 결정 | 선택 | 이유 |
|------|------|------|
| 프로젝트 구조 | 별도 레포 (`market-analyst`) | 관심사 완전 분리, 독립 CI/CD |
| DB 공유 | screener와 같은 Supabase | 기존 가격/재무 데이터 재활용, 중복 없음 |
| 실행 환경 | Claude API + Tool Use (Node.js) | 완전한 제어권, 도구 설계 자유 |
| Phase 기준 | Weinstein Stage Analysis | 체계적 프레임워크, 정량 판별 가능 |
| 섹터 시그널 | RS 가속도 + 브레드스 | 다수 종목 동반 상승 확인 |
| 산업 동향 소스 | FMP 뉴스 + 웹 검색 | 맥락 파악 + 비용 합리적 |
| 분석 깊이 | 테마 연결 + 다음 수혜 예측 | 핵심 가치 — 연결고리 추론 |
| 종목 추적 | Agent 전용 워치리스트 (이력 포함) | 연속성, Phase 전환 감지 |
| 딜리버리 | 슬랙 | 모바일 즉시 확인, 이력 검색 |
| 리포트 주기 | 매일 아침 KST 07-08시 | 장 마감 데이터 기반 |
| 리포트 포맷 | 구조화된 섹션 + 액션 추천 | 빠른 스캔 + 행동 제안 |
| FMP API 범위 | 제한 없음 (DB 우선, 필요 시 직접 호출) | 유연성 확보 |

---

## External Dependencies

| 의존성 | 용도 | 비용 |
|--------|------|------|
| Supabase (PostgreSQL) | 공유 DB — screener 기존 테이블 + 신규 테이블 | 기존 플랜 |
| FMP API | 가격, 재무, 뉴스, 실적 캘린더 | 기존 유료 구독 |
| Claude API (Anthropic) | Agent 추론 엔진 | ~$0.1-0.3/일 (Sonnet 기준) |
| Slack API | 리포트 발송 | 무료 |
| GitHub Actions | 스케줄링 (매일 실행) | 무료 티어 |

---

## Shared DB Strategy

```
screener DB (기존 테이블 — 읽기 전용)
├── symbols           → 종목 메타데이터
├── daily_prices      → 일별 가격 + RS
├── daily_ma          → 이동평균
├── daily_ratios      → 일별 밸류에이션
├── quarterly_financials → 분기 재무
├── daily_breakout_signals → 돌파 시그널
└── daily_noise_signals    → 노이즈 필터

market-analyst DB (신규 테이블 — 읽기/쓰기)
├── sector_rs_daily    → 섹터별 RS 점수/가속도/브레드스
├── stock_phases       → 종목별 Weinstein Phase 판별 결과
├── agent_watchlist    → Agent 전용 워치리스트
├── agent_watchlist_history → 워치리스트 변동 이력
├── agent_reports      → 생성된 리포트 아카이브
└── sector_themes      → 섹터 테마/내러티브 추적
```
