# Market Analyst Agent — Project Overview

**Status:** Active (운영 중)
**Created:** 2026-03-04
**Last Updated:** 2026-04-14

---

## Vision

매일 아침 Claude Agent가 자율적으로 멀티 애널리스트 토론 + 펀더멘탈 검증 + 학습 루프를 통해 시간이 지날수록 똑똑해지면서 시장을 탐색하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 카탈리스트 분석까지 포함한 리포트를 Discord로 발송하는 시스템.

### 과거 사례로 보는 목표

| 연도 | 주도섹터 | 주도주 | 배경 |
|------|----------|--------|------|
| 2023~24 | AI/국방 플랫폼 | PLTR | 정부·국방 AI 계약 급증 → 실적 흑자 전환 |
| 2024 | AI 반도체 | NVDA | 데이터센터 GPU 수요 폭발 |
| 2025 | 메모리 반도체 | MU, SK하이닉스 | HBM 수요 폭발 (AI 훈련/추론) |
| 2025~26 | 광통신 | CIEN, LITE | AI 데이터센터 인프라 확장 → 광트랜시버 병목 |

**이런 흐름을 Agent가 데이터 + 토론 + 학습 루프를 통해 포착하는 것이 목표.**

---

## System Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     ETL      │    │   Debate     │    │    Agent     │
│              │    │              │    │              │
│ Stock Phases │───▶│Multi-Model   │───▶│Claude Sonnet │
│ Sector RS    │    │GPT-4o/Gemini│    │ + 18 Tools   │
│ Industry RS  │    │/Claude 4명   │    │ + Fundamental│
│ Breakout/    │    │ + 서사 프레임 │    │ + Corporate  │
│ Noise Signal │    └──────┬───────┘    └──────┬───────┘
└──────┬───────┘           │                   │
       │            ┌──────▼───────┐           │
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
        │Supabase │  │control-  │  │ Auto     │
        │   (DB)  │  │tower(FE) │  │Issue Proc│
        └─────────┘  └──────────┘  └──────────┘
```

### 자동화 스케줄 (맥미니 launchd — 9개 작업)

모든 자동화는 맥미니 서버에서 macOS launchd로 실행. GitHub Actions는 사용하지 않음.

```
ETL 일간:        KST 08:30 화~토
  build-stock-phases → build-sector-rs → build-industry-rs
  → detect-sector-phase-events → update-sector-lag-patterns
  → validate → run-daily-agent → 리포트 검증

토론:            KST 07:00 화~금
  애널리스트 토론 → thesis 저장

주간 에이전트:    KST 10:00 토
  run-weekly-agent + 펀더멘탈 검증

QA 주간:         KST 12:00 토
  주간 QA 분석

뉴스 수집:       KST 00/06/12/18:00 매일

전략 리뷰:       KST 04:00 매일
  Claude Code CLI 기반 시스템 건강도 점검

이슈 프로세서:    KST 09:00~02:00 매 정시 (18회/일)
  GitHub 이슈 → 사전 트리아지(~3분, PROCEED/SKIP/ESCALATE) → Claude Code CLI 자동 처리 → PR 생성

PR 리뷰어:       KST 09:30~02:30 매 :30분 (18회/일)
  이슈 프로세서 생성 PR → Strategic + Code 병렬 리뷰 → GitHub 코멘트 자동 게시

로그 정리:       KST 09:00 일
```

---

## Feature Map

| # | Feature | 상태 | 핵심 |
|---|---------|------|------|
| F1 | Data Infrastructure | **완료** | Weinstein Phase, 섹터/산업 RS, 브레드스 |
| F2 | Agent Core | **완료** | Claude agentic loop, 16개 + 내부 유틸 1개 도구, 일간/주간 분리 |
| F4 | Tracking System | **완료** | 추천 성과 트래킹, Phase 이탈 감지 |
| F5 | Report & Delivery | **완료** | Discord 발송, Gist MD 첨부, 리뷰 파이프라인, QA 고도화(severity 세분화·교차 검증·급락 필터·완전성 게이트) |
| F6 | Debate & Evolution | **완료 — 운영 중** | 멀티 모델(GPT-4o/Gemini/Claude) 3라운드 토론 + thesis + 학습 루프 |
| F7 | Fundamental Validation | **완료** | Minervini SEPA 스코어링 + 전체 종목 확장 |
| Phase A | Learning Loop | **완료** | 세션 저장, few-shot 주입, 원인 분석, 패턴 승격 |
| Phase A+ | Signal Validation | **완료** | 초입 포착 도구 유효성 검증 + 편향 감지 + QA 정상화 |
| Phase A++ | Weekly Redesign | **완료** | 주간 리포트 전면 재설계 (도구 주간 집계 + 프롬프트 차별화) |
| Phase N-1 | Narrative Layer | **완료** | 수요-공급-병목 서사 프레임 + 실패 패턴 + 합의도 추적 |
| Wave 2a/2b | 서사 확장 | **완료** | N+1 병목 예측 + 공급 과잉 전환 + narrative_chains 병목 추적 |
| Sector Lag | 섹터 시차 패턴 | **완료** | Phase 전이 시차 축적 + 선행 경보 → 주간 에이전트 연동 |
| F8 | Report/Debate Dashboard | **→ control-tower 이관** | Next.js 대시보드 → control-tower 레포 분리 |
| F9 | Strategic Auto-Review | **완료** | Claude Code CLI 기반 전략 참모 자동 리뷰 (#266) |
| F10 | Corporate Analyst | **완료** | 종목 심층 분석 + 정량 목표주가 (#277) |
| F11 | Insight Briefing Pivot | **완료** | 추천→관심종목→tracked_stocks 통합, 리포트 4→3개, 90일 트래킹, KPI 전환 (#390, #773) |
| Layer 14 | 학습 루프 안정화 | **완료** | thesis 검증 수리 + 피드백 루프 보강 (#322~#332) |
| Phase N-2 | 검증 인프라 | **대기 중** | 데이터 축적 중 (착수: 3/22~) |
| ~~F3~~ | ~~Industry Intelligence~~ | 폐기 | F6 토론 엔진이 시장 분석 역할을 대체 |

---

## Agent Tools (18개 + 내부 유틸 2개)

| 도구 | 일간 | 주간 | 설명 |
|------|:----:|:----:|------|
| `getIndexReturns` | O | O | 4대 지수 + VIX + 공포탐욕지수 (주간: 누적 + 고저 위치) |
| `getMarketBreadth` | O | O | Phase 분포, Phase 2 비율, A/D ratio (주간: 5일 추이 + 전환) |
| `getLeadingSectors` | O | O | RS 상위 섹터/업종 (주간: 전주 대비 순위 변동 + 신규 진입/이탈; industry 모드: 섹터당 최대 2개 캡 적용 Top 10 + divergence) |
| `getPhase2Stocks` | | O | Phase 2 초입 종목 리스트 (RS 필터링) |
| `getPhase1LateStocks` | O | O | Phase 1 후기 종목 — Phase 2 진입 1~3개월 선행 포착 |
| `getRisingRS` | O | O | RS 30~60 상승 가속 종목 — 초기 모멘텀 포착 |
| `getFundamentalAcceleration` | | O | EPS/매출 성장 가속 종목 (Phase 1~2 대상) |
| `getUnusualStocks` | O | | 복합 조건 특이종목 스크리닝 (등락률·거래량·Phase 전환) |
| `getStockDetail` | O | O | 개별 종목 상세 분석 (Phase, RS, MA, 섹터 컨텍스트) |
| `searchCatalyst` | O | O | Brave Search 뉴스 기반 카탈리스트 |
| `readReportHistory` | | O | 과거 리포트 이력 (중복 방지) |
| `readTrackedStocksPerformance` | | O | tracked_stocks 성과 트래킹 (주간: 신규/종료/Phase 이탈 집계) |
| `saveTrackedStock` | O | O | tracked_stocks DB 저장 (source/tier/팩터 스냅샷) |
| `getTrackedStocks` | O | O | tracked_stocks 조회 (Phase/RS/SEPA 현황 브리핑) |
| `saveReportLog` | O | O | 리포트 결과 저장 |
| `sendDiscordReport` | | | Discord + Gist 리포트 발송 (리뷰 파이프라인 전용) |

---

## Implementation Progress

```
Layer 1: 데이터 인프라 (F1) — Done
  Weinstein Phase + 섹터/산업 RS + 브레드스

Layer 2: 에이전트 코어 (F2 + F5) — Done
  Claude agentic loop + 16개 + 내부 유틸 1개 도구 + Discord/Gist 딜리버리

Layer 3: 추적 시스템 (F4) — Done
  추천 종목 성과 트래킹 + Phase 이탈 감지

Layer 4: 멀티 모델 토론 시스템 (F6) — Done
  GPT-4o(매크로)/Gemini(테크)/Claude(지정학·심리) × 3라운드 + 폴백 + thesis 저장

Layer 5: Thesis 추적 + 학습 루프 (F6 확장) — Done
  LLM 자동 검증 + 원인 분석 + 패턴 승격 + 기억 주입

  학습 승격 흐름:
    적중 패턴: thesis 3회+ CONFIRMED → 이항 검정 통과 → agent_learnings (category: "principle")
    실패 패턴: collect-failure-patterns.ts → failure_patterns (70%+ 실패율 + 통계 유의성)
              → promote-learnings.ts → agent_learnings (category: "caution")
              → memoryLoader.ts → 토론 프롬프트에 "경계 패턴" 주입 → 신뢰도 낮춤
    강등: 실패율 70% 미만 하락 시 → failure_patterns.isActive=false + agentLearnings 비활성화

Layer 6: 펀더멘탈 검증 (F7) — Done
  Minervini SEPA 스코어링 (S→F 등급) + S등급 개별 리포트

Layer 7: 시그널 검증 + 품질 관리 (Phase A+) — Done
  초입 포착 도구 유효성 검증 + 편향 감지 + QA 정상화

Layer 8: 주간 리포트 재설계 (Phase A++) — Done
  도구 주간 모드 + 방향·속도 해석 중심 프롬프트

Phase N-1: 서사 레이어 확립 — Done (PR #82~#86)
  수요-공급-병목 프레임 + thesis 카테고리 분리 +
  N+1 병목 예측 + 합의도 추적 + 실패 패턴 + 위양성 축적

Wave 2a/2b: 서사 확장 — Done (PR #98, #101)
  N+1 병목 예측 + 공급 과잉 전환 + narrative_chains 병목 추적

섹터 시차 패턴 — Done (PR #102)
  sector_phase_events + sector_lag_patterns + 주간 에이전트 선행 경보

Layer 13: 전략 참모 + 기업 애널리스트 (F9 + F10) — Done
  Strategic Auto-Review (PR #266) + Corporate Analyst (PR #277)
  정량 목표주가 (DCF + P/E 피어 멀티플) + 컨센서스 교차 검증
  시장 레짐 분류 5단계 + 히스테리시스 (#270)

Layer 14: 학습 루프 안정화 — Done (PR #322~#332)
  thesis 검증 0건 수리 + 피드백 루프 3건 보강 + 발송 게이트 강화
  Phase 2 비율 이중 변환 교정 + 사후 품질 검증 파이프라인
  Post-merge 인프라 자동 반영 (DB 마이그레이션 + launchd 재로드)

Phase N-2: 검증 인프라 — 대기 중 (착수 기준 아래 참조)
  홀드아웃 테스트 + 위양성 비용 리포트
  착수 기준: 아래 3개 중 2개 이상 충족 시
    ① N-1 머지 후 2주 경과 (2026-03-22~)
    ② structural_narrative 카테고리 thesis 10건+
    ③ failure_patterns 테이블에 활성 패턴 3건+
```

---

## Component Sub-Goals

메인 골("Phase 2 초입 포착")은 정의됐지만, 각 컴포넌트의 세부 골이 부재하면 설계 오류와 방향 상실이 반복된다.
아래는 2026-04-16 세션에서 확정한 9개 컴포넌트 세부 골. 상세 논의: `wiki/concepts/component-goals.md`.

| # | 컴포넌트 | 세부 골 | 비고 |
|---|---------|---------|------|
| 1 | **etl_auto** | Phase 2 정량 광망. 소비자 노출은 tier 필터링으로 분리. | 기준 완화 금지, 시장 환경에 따라 0건 정상 |
| 2 | **agent** | featured 격상 판단 전담 (신규 진입 아님) | etl_auto 결과에서 서사·SEPA 기반 승격 |
| 3 | **thesis_aligned** | narrative chain → Phase 2 게이트 + 자동 등록 | Phase 2 진입 시 자동 tracked_stocks 등록 |
| 4 | **narrative_chains** | Phase 무관 수혜주 등록 + 주기적 동기화 | #842 beneficiary_tickers 자동 동기화 |
| 5 | **tracked_stocks 트래킹** | detection_lag + 성과 검증 + 학습 루프 | #844 포착 선행성 KPI 측정 |
| 6 | **thesis/debate** | structural_narrative + sector_rotation 중심 중장기 인사이트 | #845 short_term_outlook 제거 |
| 7 | **일간 리포트** | 컨디션 체크 + 변화 감지 (관심종목 섹션 없음) | 시장 온도 파악 전용 |
| 8 | **주간 리포트** | 한 주 종합 + 주봉 기준 선별 종목 Top 5~7 + 다음 주 관전 포인트 | #846 선별 기준 강화 |
| 9 | **기업 분석 리포트** | featured tier 한정 심층 분석 | #847 standard 제외 |

---

## Key Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| 프로젝트 구조 | 별도 레포 (`market-analyst`) | 관심사 완전 분리, 독립 CI/CD |
| DB 공유 | screener와 같은 Supabase | 기존 가격/재무 데이터 재활용, 중복 없음 |
| 실행 환경 | Claude API + Tool Use (Node.js ESM) | 완전한 제어권, 도구 설계 자유 |
| 모델 | Claude Sonnet 4.6 + GPT-4o + Gemini 2.5 Flash | 멀티 모델 다양성으로 확증편향 완화, Claude 폴백으로 안정성 확보 |
| Phase 기준 | Weinstein Stage Analysis (8개 조건) | 체계적 프레임워크, 정량 판별 가능 |
| 섹터 시그널 | RS 가속도 + 브레드스 | 다수 종목 동반 상승 확인 |
| 카탈리스트 | Brave Search API | 뉴스 검색 비용 합리적, 빠른 결과 |
| 리포트 분리 | 일간(시장 온도) / 주간(종목 발굴) | 목적별 최적화 |
| 딜리버리 | Discord Webhook + Gist | 모바일 즉시 확인, MD 파일 완전 렌더링 |
| 리포트 이력 | daily_reports DB 테이블 | JSON 파일 → DB 마이그레이션 완료 (PR #126) |
| 스케줄링 | 맥미니 launchd (9개 작업) | 로컬 제어 + SSH 원격 관리, GitHub Actions 미사용 |
| 토론 시스템 | 4명 애널리스트 × 3라운드 | 매크로/테크/지정학/심리 교차 검증 |
| 학습 루프 | thesis 검증 + 패턴 승격 | 이항 검정(p < 0.05 + Cohen's h ≥ 0.3) 유의성 필터 |
| 펀더멘탈 | Minervini SEPA 기준 | EPS/매출 YoY >25%, 가속, 마진확대 |
| 비용 | ~$15/월 (전체 API 비용, 프롬프트 캐싱 적용 후) | 주간 에이전트: runAgentLoop × ~$0.45/회. 일간 에이전트: CLI 단발 호출 → API 비용 $0. 캐시 읽기 90% 할인($0.30/M). |

---

## External Dependencies

| 의존성 | 용도 | 비용 |
|--------|------|------|
| Supabase (PostgreSQL) | 공유 DB — screener 기존 테이블 + 신규 테이블 | 기존 플랜 |
| Claude API (Anthropic) | Agent 추론 + 토론 (지정학/심리/모더레이터) | ~$15/월 (전체) |
| OpenAI API | 토론 매크로 애널리스트 (GPT-4o) | API 과금 |
| Google Generative AI | 토론 테크 애널리스트 (Gemini 2.5 Flash) | API 과금 |
| Discord Webhook | 리포트 발송 (일간/주간/에러 채널) | 무료 |
| Brave Search API | 카탈리스트 뉴스 검색 | 무료 티어 (월 2,000건) |
| GitHub Gist | MD 리포트 첨부 | 무료 |
| FMP API | 기업 데이터 (실적, 추정치, 실적콜, 피어, 목표주가) | Professional 플랜 |

---

## Shared DB Strategy

```
screener DB (기존 테이블 — 읽기 전용)
├── symbols               → 종목 메타데이터
├── daily_prices           → 일별 가격 + RS
├── daily_ma               → 이동평균 + 거래량 MA
├── daily_ratios           → 일별 밸류에이션
├── quarterly_financials   → 분기 재무
├── quarterly_ratios       → 분기 비율
├── daily_breakout_signals → 돌파 시그널
└── daily_noise_signals    → 노이즈 필터

market-analyst DB (신규 테이블 — 읽기/쓰기)
├── stock_phases           → Weinstein Phase 판별 결과
├── sector_rs_daily        → 섹터별 RS 점수/가속도/브레드스
├── industry_rs_daily      → 산업별 RS 점수/가속도/브레드스
├── tracked_stocks         → 관심종목 통합 테이블 (source: etl_auto/agent/thesis_aligned, tier: standard/featured, 90일 윈도우, 7d/30d/90d 수익률 스냅샷)
├── ~~recommendations~~    → deprecated (tracked_stocks로 통합)
├── ~~watchlist_stocks~~   → deprecated (tracked_stocks로 통합)
├── theses                 → 토론 thesis (카테고리 분리)
├── debate_sessions        → 토론 세션 저장
├── agent_learnings        → 장기 기억 (검증된 원칙 + 경계 패턴)
├── fundamental_scores     → SEPA 펀더멘탈 점수
├── failure_patterns       → Phase 2 신호 후 실패 케이스
├── narrative_chains       → 병목 생애주기 추적 (식별/해소/상태)
├── sector_phase_events    → 섹터/산업 Phase 전이 이벤트 로그
├── sector_lag_patterns    → 섹터 쌍별 시차 통계 (평균/분산/신뢰도)
├── market_regimes         → 시장 레짐 분류 (5단계 + 히스테리시스)
├── stock_analysis_reports → 기업 심층 분석 리포트 + 정량 목표주가
├── weekly_qa_reports      → 주간 QA 리포트
├── daily_reports          → 일간 리포트 (파일→DB 마이그레이션)
├── news_archive           → 뉴스 아카이브
├── signal_log             → 시그널 로그
├── market_breadth_daily   → 시장 브레드스 일별 스냅샷 (Phase 분포, A/D ratio, 신고가/신저가, VIX, Fear&Greed)
├── index_prices           → 주요 지수 일별 가격 (S&P500, NASDAQ, DOW, RUT, VIX)
├── earning_calendar       → 실적 발표 일정 (FMP)
├── stock_news             → 종목별 뉴스 (FMP)
├── company_profiles       → 기업 프로필 (FMP)
├── annual_financials      → 연간 실적 (FMP)
├── analyst_estimates      → 애널리스트 추정치 (FMP)
├── earning_call_transcripts → 실적콜 트랜스크립트 (FMP)
├── eps_surprises          → EPS 서프라이즈 (FMP)
├── peer_groups            → 피어그룹 (FMP)
└── price_target_consensus → 목표주가 컨센서스 (FMP)
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
│   │   └── reviewAgent.ts      # 리뷰 파이프라인
│   ├── debate/             # F6: 멀티 모델 토론 + 학습 루프
│   │   ├── debateEngine.ts     # 3라운드 토론 오케스트레이터
│   │   ├── llm/               # LLM Provider 추상화 (Anthropic/OpenAI/Gemini + 폴백)
│   │   ├── thesisVerifier.ts   # LLM 기반 자동 검증
│   │   ├── causalAnalyzer.ts   # 원인 분석
│   │   ├── regimeStore.ts     # 시장 레짐 분류 (5단계 + 히스테리시스)
│   │   ├── sessionStore.ts     # 세션 저장 + 유사 세션 검색
│   │   ├── memoryLoader.ts     # 학습 → 프롬프트 주입
│   │   └── narrativeChainService.ts  # 병목 체인 추적
│   ├── corporate-analyst/  # F10: 기업 심층 분석 + 정량 목표주가
│   ├── fundamental/        # F7: SEPA 펀더멘탈 검증
│   ├── tools/              # 에이전트 도구 (save_tracked_stock / get_tracked_stocks / read_tracked_stocks_performance 등)
│   ├── etl/                # F1: ETL Pipeline
│   │   ├── jobs/               # ETL 실행 파일 (update-tracked-stocks, scan-thesis-aligned-candidates 포함)
│   │   └── utils/              # Phase 판별, RS 계산, 유틸리티
│   ├── issue-processor/    # 자율 이슈 처리 (Claude Code CLI)
│   ├── pr-reviewer/        # 자동 PR 리뷰 (Strategic + Code 병렬 리뷰어)
│   ├── lib/                # 유틸리티
│   │   ├── fundamental-scorer.ts    # SEPA 스코어링
│   │   ├── statisticalTests.ts      # 이항 검정 + Cohen's h
│   │   ├── biasDetector.ts          # bull-bias 편향 감지
│   │   ├── narrativeChainStats.ts   # 병목 체인 통계
│   │   ├── sectorLagStats.ts        # 섹터 시차 통계 + 선행 경보
│   │   ├── daily-html-builder.ts    # 일간 리포트 프로그래밍 HTML 렌더러 (데이터/인사이트 분리)
│   │   └── weekly-html-builder.ts  # 주간 리포트 프로그래밍 HTML 렌더러
│   ├── db/                 # Drizzle ORM 스키마
│   └── types/              # 공유 타입 정의
├── data/
│   ├── reports/            # 리포트 이력 JSON
│   ├── qa-reports/         # QA 분석 결과 MD
│   └── review-feedback/    # 도구 유효성 검증 JSON
├── docs/features/          # 기능별 스펙/결정/플랜
└── scripts/launchd/        # 맥미니 launchd 스케줄 설정 (9개 작업)
```
