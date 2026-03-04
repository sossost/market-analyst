# Decisions: Agent Core

**Created:** 2026-03-04

## Technical Decisions

### 1. Agent 방식

| Option | Pros | Cons |
|--------|------|------|
| A: Tool-use Agent | 유연한 분석, 새로운 인사이트 발견 가능 | 토큰 소비 많음, 결과 일관성 낮을 수 있음 |
| B: 파이프라인 + LLM 작문 | 비용 낮음, 결과 일관성 높음 | 유연성 부족, 사전 정의된 분석만 가능 |
| C: 하이브리드 | 비용과 유연성 균형 | 구현 복잡도 증가 |

**Chosen:** A: Tool-use Agent
**Reason:** Agent가 데이터를 보고 스스로 판단하여 분석 흐름을 결정하는 것이 핵심 가치. 정해진 파이프라인으로는 예상치 못한 시장 변화를 포착하기 어려움.

---

### 2. Agent 런타임

| Option | Pros | Cons |
|--------|------|------|
| A: Anthropic SDK | 완전한 제어, tool_use 지원 | 도구 정의 직접 구현 필요 |
| B: Claude Agent SDK | Agent 패턴 내장 | 새로운 SDK 학습 필요, 초기 단계 |
| C: Claude Code CLI | MCP 서버 그대로 사용 가능 | CLI 의존성, 프로그래마틱 제어 어려움 |

**Chosen:** A: Anthropic SDK (@anthropic-ai/sdk)
**Reason:** tool_use를 완전히 제어할 수 있고, 가장 안정적인 방법. Agent loop를 직접 구현하여 토큰 사용량 모니터링, 에러 핸들링 등을 세밀하게 제어.

---

### 3. Claude 모델

| Option | Pros | Cons |
|--------|------|------|
| A: Opus 4.6 | 최고 추론 능력, 심층 분석 | 비용 높음 (~$40/월), 느림 |
| B: Sonnet 4.6 | 비용 대비 성능 좋음 (~$8/월) | Opus 대비 추론 능력 낮음 |
| C: Haiku 4.5 | 최저 비용 (~$2/월), 빠름 | 분석 품질 낮을 수 있음 |

**Chosen:** A: Opus 4.6
**Reason:** 주도주 발굴의 품질이 핵심. 월 $40 수준의 비용은 투자 의사결정 보조 도구로서 합리적. 추후 성과 확인 후 Sonnet으로 하향 가능.

---

### 4. 도구 설계 방식

| Option | Pros | Cons |
|--------|------|------|
| A: 목적별 전용 도구 | Agent가 의도 맞게 사용, 토큰 절약 | 도구 수 많음 |
| B: 범용 SQL 도구 | 최대 유연성 | SQL injection 위험, 토큰 소비 많음 |
| C: 하이브리드 | 균형 | 구현 복잡 |

**Chosen:** A: 목적별 전용 도구 (7개)
**Reason:** 보안 (SQL injection 불가), 토큰 효율성, Agent가 도구 이름만 보고 의도를 파악할 수 있음.

---

### 5. 리포트 전달 채널

| Option | Pros | Cons |
|--------|------|------|
| A: 텔레그램 봇 | 모바일 알림, 마크다운, 무료 | Bot Father 설정 필요 |
| B: 슬랙 Webhook | 팀 협업에 익숙, 리치 포맷 | 무료 플랜 제한 |
| C: 이메일 | 보존성 좋음 | 실시간성 떨어짐 |
| D: GitHub MD 파일 | 추가 인프라 불필요 | 알림 없음 |

**Chosen:** B: 슬랙 Webhook
**Reason:** 사용자 선호. 개인용으로 충분하며 리치 포맷팅 지원.

---

### 6. 상태/이력 저장

| Option | Pros | Cons |
|--------|------|------|
| A: JSON 파일 | 단순, git 추적 가능, Agent가 읽기 쉬움 | 검색 어려움 |
| B: DB 테이블 | 검색/집계 용이 | 마이그레이션 필요 |
| C: Markdown 파일 | 사람이 읽기 좋음 | Agent가 파싱하기 어려움 |

**Chosen:** A: JSON 파일 (data/reports/YYYY-MM-DD.json)
**Reason:** Agent가 직접 읽고 판단하는 용도이므로 JSON이 최적. 별도 인프라 불필요. Git으로 이력 관리 가능.

---

### 7. 중복 종목 필터링

| Option | Pros | Cons |
|--------|------|------|
| A: Phase 변경 + RS 급등 | 명확한 재리포트 기준 | 유연성 부족 |
| B: N일 경과 후 자동 해제 | 단순 구현 | 의미없는 재리포트 가능 |
| C: Agent 자율 판단 | 최대 유연성, 맥락 고려 가능 | 일관성 낮을 수 있음 |

**Chosen:** C: Agent 자율 판단
**Reason:** Agent가 이전 리포트 로그를 읽고 "이 종목을 다시 리포트할 만한 의미있는 변화가 있는가"를 스스로 판단. 시스템 프롬프트에서 가이드라인 제공.

---

### 8. 실패 처리

| Option | Pros | Cons |
|--------|------|------|
| A: 슬랙 에러 알림 + 로그 | 즉시 인지 가능, 기록 보존 | 슬랙 자체가 실패할 수 있음 |
| B: 자동 재시도 + 알림 | 일시적 오류 자동 복구 | 구현 복잡 |
| C: 로그만 | 조용한 실패 | 인지 늦음 |

**Chosen:** A: 슬랙 에러 알림 + 로그
**Reason:** 개인용이므로 단순한 알림으로 충분. 슬랙 전달 자체가 실패하면 로컬 파일에 fallback 저장.

---

## Architecture Decisions

### 9. Agent Loop 방식

| Option | Pros | Cons |
|--------|------|------|
| A: Manual Agentic Loop | 토큰 추적, 에러 핸들링, 반복 횟수 제어 완전한 통제 | 루프 직접 구현 필요 |
| B: SDK Tool Runner (betaZodTool) | SDK가 루프 자동 처리, Zod 타입 안전 | Beta, 토큰 추적 커스터마이징 어려움 |

**Chosen:** A: Manual Agentic Loop
**Reason:** 토큰 사용량 누적 추적, 최대 반복 횟수 제한, 도구별 에러 핸들링 등 CI 환경에서 필요한 세밀한 제어가 가능. GitHub Actions에서 안정적으로 동작해야 하므로 직접 제어가 적합.

---

### 10. Streaming 사용 여부

| Option | Pros | Cons |
|--------|------|------|
| A: Non-streaming | 구현 단순, CI 환경에 적합 | 응답 대기 시간 긴 경우 타임아웃 가능 |
| B: Streaming | 대용량 응답 처리, 타임아웃 방지 | CI에서 불필요, 구현 복잡 |

**Chosen:** A: Non-streaming
**Reason:** GitHub Actions CI 환경에서 실행. 사용자가 실시간으로 보지 않음. 각 turn의 max_tokens가 8192로 충분히 작아 타임아웃 걱정 없음.

---

### 11. Extended Thinking 사용

| Option | Pros | Cons |
|--------|------|------|
| A: 사용 안 함 | 토큰 절약, 빠른 응답 | 추론 깊이 제한 |
| B: Adaptive Thinking | 필요시 자동으로 깊이 있는 추론 | 추가 토큰 비용 |

**Chosen:** A: 사용 안 함
**Reason:** Tool-use 기반 구조화된 데이터 분석에는 standard reasoning으로 충분. 비정형 텍스트 분석이 아닌 수치 데이터 기반 판단이므로 토큰 절약 우선.

---

### 12. 슬랙 메시지 길이 처리

| Option | Pros | Cons |
|--------|------|------|
| A: 단일 메시지 + 종목 수 제한 | 단순, 핵심만 전달 | 정보 손실 가능 |
| B: 멀티 메시지 분할 전송 | 전체 정보 전달 | 구현 복잡, 메시지 순서 |
| C: 요약 + 상세 링크 | 깔끔한 포맷 | 별도 호스팅 필요 |

**Chosen:** A: 단일 메시지 + 종목 수 제한
**Reason:** Agent가 시스템 프롬프트 가이드에 따라 핵심 종목만 선별하므로 4000자 이내 유지 가능. 초과 시 Agent가 자율적으로 요약. 단순함 우선.

---

## Architecture

### Structure

```
src/agent/
├── run-daily-agent.ts         ← 진입점 (ETL 패턴 동일)
├── agentLoop.ts               ← 핵심 Agent 루프 로직
├── systemPrompt.ts            ← 시스템 프롬프트 빌더
├── slack.ts                   ← 슬랙 Webhook 전송
├── reportLog.ts               ← JSON 리포트 이력 읽기/쓰기
└── tools/
    ├── index.ts               ← 도구 레지스트리 + 실행기
    ├── types.ts               ← 도구 타입 정의
    ├── getMarketBreadth.ts    ← 시장 브레드스 지표
    ├── getLeadingSectors.ts   ← 섹터/업종 RS 랭킹
    ├── getPhase2Stocks.ts     ← Phase 2 초입 종목
    ├── getStockDetail.ts      ← 개별 종목 상세
    ├── readReportHistory.ts   ← 리포트 이력 조회
    ├── sendSlackReport.ts     ← 슬랙 리포트 전달
    └── saveReportLog.ts       ← 리포트 이력 저장
data/
└── reports/                   ← JSON 리포트 이력 디렉토리
    └── YYYY-MM-DD.json
```

### Core Flow (Pseudo-code)

```
run-daily-agent.ts (진입점)
  → 환경변수 검증 (DATABASE_URL, ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL)
  → getLatestTradeDate()로 대상 날짜 확인
  → 거래일 아닌 경우 스킵 + 슬랙 알림
  → agentLoop(config) 실행
  → 실패 시 슬랙 에러 알림 + process.exit(1)
  → pool.end()

agentLoop.ts (Agent 루프)
  → Anthropic 클라이언트 초기화
  → 시스템 프롬프트 + 초기 user 메시지 구성
  → while (iteration < MAX_ITERATIONS):
      → client.messages.create({ model, system, tools, messages })
      → 토큰 사용량 누적
      → stop_reason === "end_turn" → 완료
      → stop_reason === "tool_use" → 도구 실행
        → response.content에서 tool_use 블록 추출
        → 각 도구 실행 (tools/index.ts의 executeTool)
        → tool_result 메시지 구성
        → messages에 assistant + user(tool_results) 추가
  → AgentResult 반환 (성공/실패, 토큰, 도구 호출 수, 실행 시간)

tools/index.ts (도구 레지스트리)
  → AgentTool[] 배열로 모든 도구 등록
  → executeTool(name, input) → 이름으로 도구 찾아 실행
  → 각 도구는 JSON string 반환 (Agent가 파싱)
```

### Key Interfaces

```typescript
// 도구 정의
interface AgentTool {
  definition: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// Agent 설정
interface AgentConfig {
  targetDate: string;
  systemPrompt: string;
  tools: AgentTool[];
  model: string;          // "claude-opus-4-6"
  maxTokens: number;      // 8192
  maxIterations: number;  // 15
}

// Agent 실행 결과
interface AgentResult {
  success: boolean;
  error?: string;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  executionTimeMs: number;
  iterationCount: number;
}

// 리포트 이력 (스펙 참조)
interface DailyReportLog {
  date: string;
  reportedSymbols: ReportedStock[];
  marketSummary: {
    phase2Ratio: number;
    leadingSectors: string[];
    totalAnalyzed: number;
  };
  metadata: {
    model: string;
    tokensUsed: { input: number; output: number };
    toolCalls: number;
    executionTime: number;
  };
}

interface ReportedStock {
  symbol: string;
  phase: number;
  prevPhase: number | null;
  rsScore: number;
  sector: string;
  industry: string;
  reason: string;
  firstReportedDate: string;
}
```
