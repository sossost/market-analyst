# Claude Max 전환 — Phase 1: 단일 턴 호출 4개 전환

## 선행 맥락

**cli-migration (완료)**: 토론 엔진 Round 1~3의 `callAgent(disableTools: true)` 경로를 `claude -p` CLI로 전환하는 기획서가 이미 존재한다 (`docs/features/cli-migration/spec.md`). 당시 전환 대상 외로 명시된 파일들 — `thesisVerifier.ts`, `fundamentalAgent.ts` 등 — 이 이번 Phase 1의 전환 대상이다.

**llm/ 추상화 레이어 존재**: `src/agent/debate/llm/` 아래 `LLMProvider` 인터페이스, `AnthropicProvider`, `FallbackProvider`, `providerFactory.ts`가 이미 구축되어 있다. 이번 Phase 1은 이 인프라를 활용하여 `ClaudeCliProvider`를 추가하는 방식으로 설계한다. 기존 인터페이스를 최대한 재사용한다.

**모델 업그레이드**: 기존 `cli-migration`은 동일 모델(Sonnet) 유지를 전제로 했다. 이번 Phase 1은 **Opus로 업그레이드**가 핵심 목표 중 하나다.

## 골 정렬

**SUPPORT** — 분석 품질 향상(Opus 전환)이 Phase 2 초입 포착 정확도를 높이므로 간접 기여한다. 동시에 월 $60~100 API 비용을 $0으로 줄여 프로젝트 지속 가능성을 확보한다.

## 문제

단일 턴 LLM 호출 4개(fundamentalAgent, run-weekly-qa, causalAnalyzer, thesisVerifier)가 `@anthropic-ai/sdk`를 통해 API를 직접 호출하며 월 $60~100의 비용을 발생시킨다. Max 구독 내 `claude -p` CLI로 전환하면:

1. API 비용 $0
2. Opus 모델 사용으로 분석 품질 향상

## Before → After

**Before**: 4개 파일 각각 `new Anthropic()` → `client.messages.create()` → Sonnet API 과금

**After**: `ClaudeCliProvider` → `claude -p` CLI → Max 구독 처리 → $0. CLI 실패/rate limit 시 `AnthropicProvider`(Sonnet)로 자동 폴백.

토큰 추적은 CLI 경로에서 `{ input: 0, output: 0 }`을 반환하는 것이 허용 가능한 trade-off다. `run-weekly-qa.ts`는 토큰 수를 DB에 저장하는 로직이 있어 0으로 저장된다 — 모니터링 정보 손실이지만 분석 품질에 무영향.

## 변경 사항

### 1. `src/agent/debate/llm/claudeCliProvider.ts` 신규

`LLMProvider` 인터페이스를 구현하는 새 provider.

인터페이스 스케치:
```typescript
export class ClaudeCliProvider implements LLMProvider {
  constructor(model: string = "claude-opus-4-5") {}
  call(options: LLMCallOptions): Promise<LLMCallResult>
}
```

구현 요건:
- `child_process.execFile` 사용, stdin으로 userMessage 전달
- 모델 지정: `--model claude-opus-4-5` (0단계 플래그 확인 후 확정)
- system prompt 전달: `--system-prompt` 플래그 또는 메시지 합산 방식 — 0단계 CLI 동작 확인 후 결정
- 타임아웃: 120초
- 에러 분류: ENOENT(CLI 미설치), exit code != 0(rate limit 포함), 타임아웃 → 모두 `LLMProviderError`로 래핑
- 반환: `{ content: string, tokensUsed: { input: 0, output: 0 } }`

### 2. `src/agent/debate/llm/index.ts` 수정

`ClaudeCliProvider` export 추가.

### 3. `src/agent/fundamental/fundamentalAgent.ts` 수정

**현재**: 함수 파라미터로 `client: Anthropic` 수신 → `callWithRetry(() => client.messages.create(...))` 직접 호출

**변경**:
- `analyzeFundamentals` 시그니처에서 `client: Anthropic` 파라미터 제거
- 함수 내부에서 `FallbackProvider(new ClaudeCliProvider(), new AnthropicProvider(MODEL), 'ClaudeCLI')` 생성
- `provider.call({ systemPrompt, userMessage, maxTokens: MAX_TOKENS })` 호출
- `tokensUsed` 반환 유지 (CLI 경로는 `{ input: 0, output: 0 }`)

### 4. `src/agent/fundamental/runFundamentalValidation.ts` 수정

`analyzeFundamentals(client, ...)` 호출부에서 `client` 인수 제거.

### 5. `src/agent/run-weekly-qa.ts` 수정

**현재**: `new Anthropic()` → `client.messages.create()` 인라인 호출 (모듈 레벨 SDK 직접 사용)

**변경**:
- Anthropic SDK import/`new Anthropic()` 제거
- `FallbackProvider(new ClaudeCliProvider(), new AnthropicProvider(MODEL), 'ClaudeCLI')` 생성
- `provider.call({ systemPrompt: SYSTEM_PROMPT, userMessage: userPrompt })` 호출
- `response.usage.input_tokens / output_tokens` → `result.tokensUsed.input / output`로 교체
- DB 저장 시 0으로 저장 허용 (Phase 1 범위)

### 6. `src/agent/debate/causalAnalyzer.ts` 수정

**현재**: 함수 내부 `new Anthropic()` → `callWithRetry(() => client.messages.create(...))`

**변경**:
- `Anthropic` import 제거
- `FallbackProvider(new ClaudeCliProvider(), new AnthropicProvider(MODEL), 'ClaudeCLI')` 생성
- `provider.call(...)` 호출
- usage 로깅: `result.tokensUsed.input / output` 사용

### 7. `src/agent/debate/thesisVerifier.ts` 수정 (LLM 분기만)

**현재**: LLM 분기에서 `new Anthropic()` → `callWithRetry(() => client.messages.create(...))`

**변경**:
- LLM 분기(`if (llmTheses.length > 0)` 블록) 내부만 교체
- 정량 분기(`tryQuantitativeVerification`)는 무변경
- `provider.call(...)` 결과에서 `result.tokensUsed.*` 사용

## 작업 계획

### 0단계 — CLI Opus 호환 확인 (구현 전 필수)

**담당**: 탐색 에이전트

- `claude --help`로 `--model`, `--print`, `--output-format`, `--system-prompt` 플래그 존재 확인
- `claude --print --model claude-opus-4-5 -p "테스트"` 실행 → Opus 응답 수신 확인
- CLI 인증이 Max 구독을 사용하는지 확인 (`ANTHROPIC_API_KEY` 환경변수 없을 때도 동작하는지)

합격 기준: Opus 모델로 텍스트 응답 수신 성공

실패 시 조정:
- `--model` 미지원 → `claude --version`으로 버전 확인 후 지원 플래그 조사
- Opus 모델명 오류 → 지원 모델명 목록 확인 후 대체

### 1단계 — `ClaudeCliProvider` 구현

**담당**: 구현 에이전트

완료 기준:
- `LLMProvider` 인터페이스 구현 완료
- 단위 테스트: `execFile` mock으로 성공/ENOENT/타임아웃/non-zero exit 4가지 케이스 통과
- `FallbackProvider(ClaudeCliProvider, AnthropicProvider)` 조합에서 CLI 실패 시 SDK 폴백 확인하는 테스트 통과

### 2단계 — 4개 파일 전환 (2A/2B/2C/2D 병렬 가능)

**담당**: 구현 에이전트

**2A. fundamentalAgent.ts + runFundamentalValidation.ts**
- 시그니처 변경: `analyzeFundamentals(client, ...)` → `analyzeFundamentals(...)`
- 완료 기준: `buildUserMessage`, `extractDataQualityVerdict` 단위 테스트 통과

**2B. run-weekly-qa.ts**
- 인라인 SDK 제거 → provider로 교체
- 완료 기준: `extractScore`, `extractCeoSummary`, `extractNeedsDecision` 단위 테스트 통과

**2C. causalAnalyzer.ts**
- `callWithRetry(() => client.messages.create(...))` → `provider.call(...)` 교체
- 완료 기준: `parseCausalAnalysis` 단위 테스트 통과

**2D. thesisVerifier.ts (LLM 경로만)**
- LLM 분기만 교체, 정량 분기 무변경
- 완료 기준: `parseJudgments` 단위 테스트 통과

### 3단계 — 통합 검증

**담당**: 검증 에이전트

- `tsc --noEmit` 통과
- `yarn test` 전체 통과
- (선택) 맥미니에서 `run-weekly-qa.ts` dry-run — CLI 경로로 실제 응답 수신 확인

### 4단계 — 코드 리뷰 + PR

**담당**: code-reviewer → pr-manager

## 리스크

### HIGH: `--model` 플래그 미지원 또는 Opus 모델명 불일치

`claude` CLI 버전에 따라 `--model` 플래그가 없거나 모델명이 다를 수 있다. 0단계에서 확인 필수. 실패 시 Sonnet으로 대체 — 비용 절감 목표는 유지됨.

### HIGH: system prompt 전달 방식 불명확

`--system-prompt` 플래그 미지원 시 system prompt가 페르소나 역할을 하지 못해 분석 품질이 저하된다. 0단계에서 CLI 플래그 목록 확인 후 구현 방식 확정.

### MEDIUM: `analyzeFundamentals` 시그니처 변경 파급

`client: Anthropic` 파라미터 제거 시 다른 호출부가 있으면 컴파일 에러 발생. 구현 전 `grep -r "analyzeFundamentals" src/`로 호출처 전수 확인 필요.

### MEDIUM: `run-weekly-qa.ts`의 토큰 DB 저장 0 처리

CLI 경로에서 `tokens_input = 0, tokens_output = 0`으로 저장된다. 과거 데이터와 불연속이 생기지만 분석 품질에 무영향. Phase 2에서 NULL 허용 스키마 변경으로 개선 예정.

### LOW: 폴백 발생 시 Sonnet으로 품질 저하

rate limit/CLI 오류 시 Opus가 아닌 Sonnet으로 폴백. 현재 상태(Sonnet만)와 동일하므로 퇴보는 아님.

## 의사결정 필요

**없음 — 바로 구현 가능**

단, 0단계에서 아래 항목 실패 시 구현 에이전트가 자율 조정:
1. `--model claude-opus-4-5` 미지원 → 지원 가능한 Opus 모델명으로 교체
2. `--system-prompt` 플래그 미지원 → user message에 system prompt 합산하는 방식으로 구현
3. CLI 전체 미설치 → 설치 선행 후 진행 (CEO에게 알림 필요)
