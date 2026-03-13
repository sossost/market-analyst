# 토론 애널리스트 멀티 모델 다양성 도입

> **상태:** 구현 완료 — PR 대기 중

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
- `FallbackProvider` 래퍼로 외부 API 장애 시 Claude 자동 폴백
- `personas.ts`가 frontmatter의 `model` 필드를 실제 라우팅에 사용
- 각 애널리스트가 선언한 모델로 실제 호출됨
- 모더레이터는 Claude 유지 (JSON 구조화 신뢰도 이슈)

---

## 모델 배치 결정

| 역할 | 변경 전 | 변경 후 | 배치 근거 |
|------|---------|---------|-----------|
| macro-economist | Claude Sonnet | **GPT-4o** | 미국 경제·연준 정책에서 OpenAI 학습 데이터 강점. 매크로 거시 분석에서 Claude와 가장 다른 관점 기대. |
| tech-analyst | Claude Sonnet | **Gemini 2.0 Flash** | Google이 AI/반도체/클라우드 산업 내부에서 다른 시각 보유. Google Trends·YouTube 데이터 기반 학습 특성상 소비자 tech 채택 곡선에서 차별화. |
| geopolitics | Claude Sonnet | **Claude Sonnet** (유지) | 지정학은 프롬프트 제어가 가장 중요한 역할. Claude의 균형 잡힌 지정학 처리가 현재 가장 안정적. |
| sentiment-analyst | Claude Sonnet | **Claude Sonnet** (유지) | 심리 분석은 수치 해석보다 뉘앙스 처리가 중요. 변경 효과가 불확실하므로 1단계 대상 제외. |
| moderator | Claude Sonnet | **Claude Sonnet** (유지) | JSON 구조화(thesis + marketRegime) 파싱 안정성이 시스템 기능에 직결. 가장 리스크가 높아 변경 보류. |

---

## 구현 결과

### 1. LLM Provider 추상화 (`src/agent/debate/llm/`)

```
src/agent/debate/llm/
├── types.ts              — LLMProvider 인터페이스, LLMCallOptions/Result, ConfigurationError, LLMProviderError
├── anthropicProvider.ts  — Anthropic 구현체 (exponential backoff 재시도)
├── openaiProvider.ts     — OpenAI gpt-4o 구현체 (rate limit 재시도)
├── geminiProvider.ts     — Gemini 2.0 Flash 구현체 (RESOURCE_EXHAUSTED 감지)
├── fallbackProvider.ts   — 외부 API 장애 시 Claude 자동 폴백 래퍼
├── providerFactory.ts    — model string → LLMProvider 인스턴스 매핑 + 폴백 래핑
└── index.ts              — barrel export
```

**인터페이스:**
```typescript
export interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMCallResult>;
}
```

**폴백 동작:**
- `gpt-*` → `FallbackProvider(OpenAIProvider → AnthropicProvider)`
- `gemini-*` → `FallbackProvider(GeminiProvider → AnthropicProvider)`
- `claude-*` / `sonnet` / `haiku` / `opus` → `AnthropicProvider` 직접 (폴백 없음)
- primary 실패 시 warn 로그 + Claude 자동 재시도
- primary + fallback 둘 다 실패 시 에러 전파 → `Promise.allSettled` 내성 처리

### 2. 리팩터링된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `round1-independent.ts` | `client: Anthropic` → `getProvider: (model: string) => LLMProvider` |
| `round2-crossfire.ts` | 동일 |
| `round3-synthesis.ts` | `client: Anthropic` → `provider: LLMProvider` |
| `debateEngine.ts` | `new Anthropic()` 제거, `createProvider()` 팩토리 도입 |
| `callAgent.ts` | tool-use 루프 유지 (Round 3 모더레이터 전용으로 잔존) |

### 3. 에이전트 파일 변경

- `.claude/agents/macro-economist.md`: `model: sonnet` → `model: gpt-4o`
- `.claude/agents/tech-analyst.md`: `model: sonnet` → `model: gemini-2.0-flash`

### 4. 패키지 의존성

```json
"openai": "^6.x",
"@google/generative-ai": "^0.x"
```

### 5. 환경 변수 (신규)

```
OPENAI_API_KEY=your-openai-api-key
GOOGLE_GENERATIVE_AI_API_KEY=your-google-generative-ai-api-key
```

맥미니 서버: launchd plist에 EnvironmentVariables 항목 추가 필요.

---

## 에러 핸들링

| 상황 | 동작 |
|------|------|
| API Key 미설정 | Provider 생성 시점에서 즉시 `ConfigurationError` throw |
| Rate limit (429) | 각 Provider 내부에서 exponential backoff (15s → 30s → 60s, 최대 3회) |
| 외부 SDK 오류 | `LLMProviderError`로 래핑 후 전파 |
| GPT-4o / Gemini 장애 | `FallbackProvider`가 Claude로 자동 폴백 + warn 로그 |
| Claude 폴백까지 실패 | 에러 전파 → `Promise.allSettled`가 해당 에이전트 스킵, 나머지로 토론 계속 |

---

## 테스트

- **76 files, 1137 tests — 전부 통과**
- Provider 단위 테스트: API Key 미설정, SDK 오류 래핑, 토큰 집계
- providerFactory 테스트: 모든 model alias/prefix 라우팅
- FallbackProvider 테스트: primary 성공/실패/양측 실패 시나리오
- debateEngine 통합 테스트: 멀티 모델 mock + 폴백 동작 검증

---

## 리스크

| 리스크 | 가능성 | 대응 |
|--------|--------|------|
| GPT-4o / Gemini 한국어 응답 품질이 Claude보다 낮음 | 중간 | 시스템 프롬프트에 "반드시 한국어로만 작성" 명시. 품질 기준은 round3에 이미 있음. |
| 외부 API Rate Limit이 Claude와 다름 | 높음 | 각 Provider가 자체 backoff 보유. 배치 딜레이(10초)도 유지. |
| GPT-4o / Gemini가 thesis JSON 포맷을 다르게 생성 | 낮음 | 모더레이터(Claude)가 thesis 추출 담당. 전문가 모델 변경이 JSON 파싱에 영향 없음. |
| 맥미니 서버 환경 변수 추가 필요 | 확실 | `.env.example`에 가이드 기재. launchd plist 수정 별도 필요. |

---

## 배포 전 체크리스트

- [ ] 맥미니 서버에 `OPENAI_API_KEY` 환경 변수 설정
- [ ] 맥미니 서버에 `GOOGLE_GENERATIVE_AI_API_KEY` 환경 변수 설정
- [ ] launchd plist 수정 (`scripts/launchd/setup-launchd.sh` 참조)
- [ ] 토론 1회 실제 실행 smoke test
