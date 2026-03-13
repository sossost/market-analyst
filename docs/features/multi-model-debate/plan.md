# 토론 애널리스트 멀티 모델 다양성 도입

## 선행 맥락

없음 — 이전에 멀티 모델 도입 시도나 관련 결정 기록 없음.

단, 기존 확증편향 관련 보완 이력은 존재:
- 통계적 편향 감지 (`src/lib/statisticalTests.ts`)
- bull-bias 정량 기준 도입 (PR #200)
- Round 2 crossfire에서 "동의만 하는 것은 가치 없다. 반드시 최소 1가지는 반박하라" 강제

이 모든 조치는 **동일 모델 내** 소프트웨어적 해결이었다. 멀티 모델은 이와 다른 레벨 — 모델 아키텍처 자체의 다양성을 도입한다.

---

## 골 정렬

**ALIGNED** — 직접 기여

같은 Claude 모델이 5개 역할을 연기하면, 사전학습 가중치 수준의 blind spot이 공유된다. 구조적 확증편향이 발생한다는 뜻이다. GPT-4o와 Gemini는 다른 사전학습 데이터셋, 다른 RLHF 선호, 다른 지식 커트오프를 가지므로, 동일 프롬프트에서도 다른 각도의 이견이 발생한다. 이는 "남들보다 먼저 포착"이라는 골에 직접 기여한다 — Claude가 놓치는 신호를 다른 모델이 감지할 가능성이 생긴다.

---

## 문제

토론 시스템이 Claude 단일 모델로 운영되어, 4명 애널리스트가 사전학습 레벨의 blind spot을 공유한다. Round 2 crossfire에서 반박이 나오더라도 같은 가중치에서 생성된 반박이므로, 진짜 시각차가 아니라 프롬프트 엔지니어링 수준의 편향 완화에 그친다.

---

## Before → After

**Before:**
- 모든 에이전트가 `callAgent(anthropic_client, ...)` 호출
- `callAgent.ts`에 `MODEL = "claude-sonnet-4-20250514"` 하드코딩
- `PersonaDefinition.model` 필드는 `.md` 파일 frontmatter에 있지만 `callAgent`에서 무시됨
- 4 experts + 1 moderator = 전원 Claude Sonnet

**After:**
- `LLMProvider` 추상화 레이어 도입 — Anthropic / OpenAI / Google 공통 인터페이스
- `personas.ts`가 frontmatter의 `model` 필드를 실제 라우팅에 사용
- 각 애널리스트가 선언한 모델로 실제 호출됨
- 모더레이터는 Claude 유지 (JSON 구조화 신뢰도 이슈)

---

## 모델 배치 결정

| 역할 | 현재 | 변경 후 | 배치 근거 |
|------|------|---------|-----------|
| macro-economist | Claude Sonnet | **GPT-4o** | 미국 경제·연준 정책에서 OpenAI 학습 데이터 강점. 매크로 거시 분석에서 Claude와 가장 다른 관점 기대. |
| tech-analyst | Claude Sonnet | **Gemini 2.0 Flash** | Google이 AI/반도체/클라우드 산업 내부에서 다른 시각 보유. Google Trends·YouTube 데이터 기반 학습 특성상 소비자 tech 채택 곡선에서 차별화. |
| geopolitics | Claude Sonnet | **Claude Sonnet** (유지) | 지정학은 프롬프트 제어가 가장 중요한 역할. Claude의 균형 잡힌 지정학 처리가 현재 가장 안정적. 1단계에서 변경 리스크 감수 불필요. |
| sentiment-analyst | Claude Sonnet | **Claude Sonnet** (유지) | 심리 분석은 수치 해석보다 뉘앙스 처리가 중요. 변경 효과가 불확실하므로 1단계 대상 제외. |
| moderator | Claude Sonnet | **Claude Sonnet** (유지) | JSON 구조화(thesis + marketRegime) 파싱 안정성이 시스템 기능에 직결. 가장 리스크가 높아 변경 보류. |

**1단계 요약:** macro → GPT-4o, tech → Gemini 2.0 Flash, 나머지 3개 Claude 유지.

---

## 변경 사항

### 1. LLM Provider 추상화 (`src/agent/debate/llmProvider.ts` 신규)

```typescript
export interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LLMCallResult {
  content: string;
  tokensUsed: { input: number; output: number };
}

export interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMCallResult>;
}
```

세 개의 구현체:
- `AnthropicProvider` — 기존 `callAgent` 로직을 래핑
- `OpenAIProvider` — `openai` SDK 사용 (`gpt-4o`)
- `GeminiProvider` — `@google/generative-ai` SDK 사용 (`gemini-2.0-flash`)

### 2. Provider Factory (`src/agent/debate/providerFactory.ts` 신규)

`PersonaDefinition.model` 값을 받아 해당 `LLMProvider` 인스턴스를 반환.

```typescript
// PersonaDefinition.model → 실제 프로바이더 매핑
// "claude-sonnet-*" → AnthropicProvider
// "gpt-4o" → OpenAIProvider
// "gemini-2.0-flash" → GeminiProvider
```

환경 변수:
- `ANTHROPIC_API_KEY` — 기존 (이미 있음)
- `OPENAI_API_KEY` — 신규 필요
- `GOOGLE_GENERATIVE_AI_API_KEY` — 신규 필요

### 3. 에이전트 파일 frontmatter 수정 (`.claude/agents/`)

`macro-economist.md`:
```
model: gpt-4o
```

`tech-analyst.md`:
```
model: gemini-2.0-flash
```

나머지 3개 (`geopolitics.md`, `sentiment-analyst.md`, `moderator.md`): 변경 없음.

### 4. `callAgent.ts` 리팩터링

- `MODEL` 상수 제거
- `client: Anthropic` 파라미터를 `provider: LLMProvider`로 교체
- 도구 사용(tool-use) 루프는 Anthropic 전용 로직이므로: Round 1/2에서 `disableTools: true`가 이미 강제되어 있어 문제없음. Round 1/2는 도구 없이 호출되므로 모든 프로바이더에서 동작 가능.

### 5. `debateEngine.ts` 수정

`new Anthropic()` 클라이언트 생성 제거. 각 `expert`의 `persona.model`에 따라 `providerFactory.createProvider(model)`로 개별 프로바이더 생성 후 라운드 함수에 전달.

### 6. Round 1/2 함수 시그니처 변경

`client: Anthropic` → `getProvider: (model: string) => LLMProvider`

각 expert 호출 시 해당 expert의 model로 프로바이더를 가져와 사용.

### 7. 패키지 의존성 추가

```json
"openai": "^4.x",
"@google/generative-ai": "^0.x"
```

---

## 작업 계획

### Phase 1 — LLM 추상화 레이어 구축 (핵심)

| 단계 | 무엇을 | 에이전트 | 완료 기준 |
|------|--------|---------|-----------|
| 1-1 | `src/agent/debate/llmProvider.ts` — 인터페이스 + AnthropicProvider 구현 | backend-engineer | 기존 테스트 전부 통과 |
| 1-2 | `src/agent/debate/providerFactory.ts` — 팩토리 함수 | backend-engineer | 단위 테스트 작성 + 통과 |
| 1-3 | `callAgent.ts` 리팩터링 — provider 기반으로 교체 | backend-engineer | 기존 테스트 전부 통과 |
| 1-4 | `round1-independent.ts`, `round2-crossfire.ts`, `debateEngine.ts` 시그니처 수정 | backend-engineer | 타입 에러 0개 |

**1단계 완료 기준:** AnthropicProvider만 붙여도 기존 전체 토론이 동일하게 동작해야 한다.

### Phase 2 — OpenAI/Gemini Provider 구현

| 단계 | 무엇을 | 에이전트 | 완료 기준 |
|------|--------|---------|-----------|
| 2-1 | `openai` 패키지 설치 + `OpenAIProvider` 구현 | backend-engineer | `OPENAI_API_KEY`로 단독 호출 성공 |
| 2-2 | `@google/generative-ai` 패키지 설치 + `GeminiProvider` 구현 | backend-engineer | `GOOGLE_GENERATIVE_AI_API_KEY`로 단독 호출 성공 |
| 2-3 | 각 Provider 단위 테스트 (mock 기반) | backend-engineer | 커버리지 80% 이상 |

**에러 핸들링 요구사항:**
- Rate limit (429) 대응: 각 Provider가 기존 `callWithRetry` 패턴과 동일한 exponential backoff 적용
- API Key 미설정 시: Provider 생성 시점에 즉시 `ConfigurationError` throw (호출 시점 아님)
- 외부 SDK 오류: `LLMProviderError`로 래핑하여 상위로 전파 — `debateEngine`의 기존 `Promise.allSettled` 내성 처리가 그대로 동작

### Phase 3 — 에이전트 파일 수정 + 환경 변수 설정

| 단계 | 무엇을 | 에이전트 | 완료 기준 |
|------|--------|---------|-----------|
| 3-1 | `macro-economist.md`, `tech-analyst.md` frontmatter `model` 필드 수정 | backend-engineer | parseFrontmatter에서 신규 model 값 올바르게 파싱 |
| 3-2 | `.env.example`에 `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` 추가 | backend-engineer | 맥미니 서버 환경 변수 설정 가이드 포함 |

### Phase 4 — 통합 테스트 + 검증

| 단계 | 무엇을 | 에이전트 | 완료 기준 |
|------|--------|---------|-----------|
| 4-1 | `debateEngine` 통합 테스트 — 3개 모델이 섞인 전체 토론 mock 실행 | backend-engineer | 토론 결과 구조 유효, agentErrors 없음 |
| 4-2 | 프로바이더 장애 내성 테스트 | backend-engineer | GPT-4o 실패 시 나머지 3명으로 토론 계속 진행 확인 |
| 4-3 | 실제 API 연동 smoke test (맥미니에서 수동) | — | 토론 1회 실행, 리포트 정상 생성 확인 |

---

## 리스크

| 리스크 | 가능성 | 대응 |
|--------|--------|------|
| GPT-4o / Gemini의 한국어 응답 품질이 Claude보다 낮음 | 중간 | Round 1/2 시스템 프롬프트에 "반드시 한국어로만 작성" 명시. 현재 `round3-synthesis.ts` 품질 기준에 이미 있음. |
| 외부 API Rate Limit이 Claude와 다름 | 높음 | `BATCH_SIZE = 2` + 10초 딜레이가 현재 배치 방식. 각 Provider가 자체 backoff를 가지므로 독립적으로 처리됨. |
| GPT-4o / Gemini가 thesis JSON 포맷을 다르게 생성 | 낮음 | Round 3 모더레이터는 Claude 유지. thesis 추출은 모더레이터 책임이므로 전문가 모델 변경이 JSON 파싱에 영향 없음. |
| `@google/generative-ai` SDK의 토큰 카운팅 방식이 다름 | 낮음 | `tokensUsed` 반환 시 각 SDK의 토큰 집계를 LLMCallResult로 통일. 로그 목적이므로 정확도 차이 수용 가능. |
| 맥미니 서버 환경 변수 추가 필요 | 확실 | launchd plist 수정 필요. Phase 3 완료 후 별도 서버 설정 작업. |

---

## 의사결정 필요

없음 — CEO가 이미 결정:
- 비용 무시 가능
- A/B 테스트 불필요
- 즉시 전환
- 이론적으로 확증편향 개선이 확실하면 진행
