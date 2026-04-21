# Market Analyst Agent

Claude Agent가 자율적으로 시장을 분석하여 **주도섹터와 Phase 2 초입 주도주**를 발굴하고, 멀티 애널리스트 토론 + 펀더멘탈 검증 + 학습 루프를 통해 시간이 지날수록 정교해지는 시장 분석 엔진.

**핵심 목표:** Phase 2(상승 초입) 주도섹터/주도주를 남들보다 먼저 포착하여 알파를 형성

---

## 컴포넌트 세부 골

| 컴포넌트 | 세부 골 |
|----------|--------|
| **etl_auto** | Phase 2 초입 후보를 8개 게이트로 광망 수집 — 누락 없이, 오염 없이 |
| **thesis_aligned** | narrative_chains 수혜주를 자동 등록 — 서사 기반 선제 포착 |
| **tracked_stocks** | detection_lag(entry_date - phase2_since) 소스별 통계로 포착 선행성 측정 |
| **Multi-Model Debate** | RS 귀납 → 공급망 연역: 강한 종목의 이유를 역추적하고, 병목 식별 → 수혜 종목을 선행 예측 |
| **Learning Loop** | thesis 적중/실패 원인 분석 → 패턴 승격 → 다음 토론 few-shot 주입. 정량 검증 가능 지표(지수·섹터 RS·신용 지표 4종) 프롬프트 주입으로 자동 검증 커버리지 확대 |
| **일간 리포트** | 시장 컨디션 체크 — 진입/관망 판단 근거 제공 |
| **주간 리포트** | 주봉 관점 Top 5~7 선별 + 포트폴리오 현황 — CEO의 매주 판단 지원 |
| **기업 리포트** | featured 종목 한정 심층 분석 + 정량 목표주가 — 확신도 제고 |

---

## 시스템 플로우

```
ETL 파이프라인 ──────────────────────────────────────────────────────────────
  Weinstein Phase 판별  │  섹터/업종 RS 계산  │  시장 브레드스  │  FRED 신용지표
        │
        ▼
Multi-Model Debate (매일 22:00 UTC)
  Claude Opus(테크·매크로) / GPT-4o(심리) / Gemini 2.5 Flash(지정학) — 3라운드 토론
  RS 귀납 → 공급망 연역 → 수요-공급-병목 서사 → thesis 구조화
  병목 체인(narrative_chains) 추적: 생애주기(식별→해소→다음 병목) + Meta-Regime
        │
        ▼
Learning Loop (자동)
  thesis 자동 검증(CONFIRMED/INVALIDATED) → 원인 분석 → 패턴 승격 → few-shot 주입
  실패 패턴 70%+ → 필터링 규칙 승격 → etl_auto 스캔 시 자동 차단
        │
        ▼
QA Gate ── 품질 검증 → 조건부 발송
        │
        ▼
Delivery
  일간 리포트(HTML + Discord) │ 주간 리포트(HTML + Discord) │ 기업 리포트(S등급 종목)
```

---

## Output

| 리포트 | 주기 | 채널 | 핵심 내용 |
|--------|------|------|----------|
| 일간 브리핑 | 평일 장 마감 후 | Discord + HTML | 시장 온도 + 시장 브레드스(MA50 이상 비율 + 다이버전스 알럿) + 섹터/업종 RS 랭킹 + 특이종목 + RS 상승 초기종목 |
| 주간 분석 | 토요일 | Discord + HTML | 섹터 로테이션 + 관심종목 궤적(Top 5~7) + 주간 토론 종합(병목 추이·주도섹터 합의·과열 경고) + 포트폴리오 현황 |
| 기업 리포트 | 주간(featured 한정) | Discord | 피어 멀티플 기반 목표주가 + 어닝콜 분석 |
| 전략 브리핑 | 매일 04:00 | `memory/strategic-briefing.md` | 8개 영역 시스템 분석 + 골 정렬 판단 근거 |

---

## 자율 운영 스케줄 (맥미니 launchd)

| 작업 | 스케줄 (KST) | 내용 |
|------|-------------|------|
| ETL Daily | 07:00 화~토 | ETL 6단계 → 토론 → 일간 리포트 → QA 검증 |
| ETL Weekly | 08:00 일 | 분기 재무·비율 갱신 |
| Agent Weekly | 10:00 토 | 주간 리포트 + 주간 검증 |
| News Collect | 06:00, 18:00 매일 | 뉴스 수집 (2회/일) |
| Strategic Review | 04:00 매일 | 전략 참모 리뷰 → `strategic-briefing.md` 갱신 |
| Issue Triage | 09:00 매일 | 미트리아지 이슈 사전 분류 |
| Issue Processor | 10:00~02:00 매 정시 (17회/일) | triaged 이슈 자동 구현 → PR 생성 |
| PR Reviewer | 09:30~02:30 매 :30분 (18회/일) | PR Strategic + Code 리뷰 → 코멘트 게시 |
| System Audit | 06:00 토 | 데이터 무결성 + 코드-DB 정합성 + 파이프라인 연결성 감사 |
| Log Cleanup | 09:00 일 | 30일 이상 로그 정리 |

---

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

| 변수 | 설명 | 필수 |
|------|------|:----:|
| `DATABASE_URL` | Supabase PostgreSQL 연결 문자열 | O |
| `ANTHROPIC_API_KEY` | Claude API (에이전트·토론·QA) | O |
| `OPENAI_API_KEY` | GPT-4o (심리 애널리스트) | O |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini 2.5 Flash (지정학 애널리스트) | O |
| `DISCORD_WEBHOOK_URL` | 일간 리포트 채널 | O |
| `DISCORD_WEEKLY_WEBHOOK_URL` | 주간 리포트 채널 | O |
| `DISCORD_STOCK_REPORT_WEBHOOK_URL` | S등급 종목 리포트 채널 | O |
| `DISCORD_ERROR_WEBHOOK_URL` | 에러 알림 채널 | - |
| `BRAVE_API_KEY` | 카탈리스트 뉴스 검색 | O |
| `GITHUB_TOKEN` | Gist MD 첨부 (Supabase 미설정 시 fallback) | O |
| `SUPABASE_URL` | HTML 리포트 Storage 업로드 | - |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key | - |

### Run

```bash
# ETL 파이프라인
yarn etl:stock-phases       # Weinstein Phase 판별 + 거래량 돌파 신호
yarn etl:sector-rs          # 섹터 RS 계산
yarn etl:industry-rs        # 산업 RS 계산
yarn etl:index-prices       # 지수 가격 (S&P 500, NASDAQ, DOW, Russell 2000, VIX)
yarn etl:update-tracked-stocks  # tracked_stocks Phase 궤적 + 수익률 스냅샷 업데이트
yarn etl:scan-thesis-aligned    # narrative_chains 수혜주 → tracked_stocks 자동 등록
yarn etl:verify-theses      # thesis 시장 데이터 검증
yarn etl:promote-learnings  # 반복 적중 패턴 → 장기 기억 승격

# Agent 실행
yarn agent:daily            # 일간 시장 브리핑
yarn agent:weekly           # 주간 종목 분석
yarn agent:debate           # 애널리스트 토론 (매크로/테크/지정학/심리)

# 테스트
yarn test                   # 전체 테스트
yarn typecheck              # 타입 체크

# DB
yarn db:generate            # 마이그레이션 생성
yarn db:push                # 스키마 적용
yarn db:studio              # Drizzle Studio UI
```

---

## Tech Stack

| 영역 | 기술 |
|------|------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript (strict) |
| Package Manager | Yarn (Classic 1.x) |
| AI | Claude Opus 4.7, GPT-4o, Gemini 2.5 Flash (멀티 모델 토론) |
| Database | PostgreSQL (Supabase) via Drizzle ORM |
| Testing | Vitest |
| Scheduling | macOS launchd (맥미니 서버) |
| Delivery | Discord Webhook + Supabase Storage (HTML) + GitHub Gist (fallback) |
| Search | Brave Search API |
| Automation | Claude Code CLI (Auto Issue Processor, QA) |

---

## 문서

| 문서 | 내용 |
|------|------|
| [`docs/how-it-works.md`](docs/how-it-works.md) | 파이프라인 상세, Agent Tools 테이블, Learning Loop 구성, SEPA 등급표 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 전체 로드맵 + 진행 예정 |
| [`wiki/`](wiki/) | 지식 위키 — 데이터 파이프라인, 리포트 레이아웃, DB 스키마, 컴포넌트 세부 골 |

---

## License

Private
