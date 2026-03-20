# CLI 전환 Phase 2 — 토론 엔진 + 리뷰 에이전트

## 선행 맥락

PR #257에서 Phase 1 전환 완료:
- `thesisVerifier.ts` — ClaudeCliProvider primary + AnthropicProvider fallback
- `fundamentalAgent.ts` — 동일 패턴
- `causalAnalyzer.ts`, `weekly-qa.ts` — 전환 완료

미전환 잔존 대상:
- `providerFactory.ts` — 토론 Round 1/2/3 전체가 이걸 통해 AnthropicProvider 직접 사용
- `reviewAgent.ts` — `new Anthropic()` client 직접 인스턴스화 + `callWithRetry` 사용
- `run-debate-agent.ts` — `ANTHROPIC_API_KEY`를 required로 검증

## 골 정렬

SUPPORT — API 비용 절감 + Claude Max 구독 활용 극대화. 직접 골(Phase 2 포착)에 기여하지는 않지만, 운영 지속성(비용 $0)을 높여 간접 기여함.

## 문제

토론 엔진(Round 1/2/3)과 리뷰 에이전트가 직접 Anthropic API를 호출하고 있어 토론 1회 실행 시 상당한 토큰 비용이 발생한다. Phase 1에서 보조 컴포넌트들은 이미 Claude CLI 우선으로 전환되었으나 핵심 경로(토론 본체, 리뷰)가 남아 있다.

## Before → After

**Before**: `createProvider("sonnet")` → `AnthropicProvider` (API 과금). `reviewAgent.ts` → `new Anthropic()` 직접 호출. `run-debate-agent.ts` → API 키 없으면 기동 불가.

**After**: `createProvider("sonnet")` → `FallbackProvider(ClaudeCliProvider, AnthropicProvider)` (CLI 우선, API 폴백). `reviewAgent.ts` → `ClaudeCliProvider` 우선 사용. `run-debate-agent.ts` → API 키 없어도 기동, 경고만 출력.

## 변경 사항

### 1. `src/agent/debate/llm/providerFactory.ts`

Claude 모델 분기(`sonnet`, `haiku`, `opus`, `claude-*`)에서:
- 기존: `return new AnthropicProvider(resolvedModel)`
- 변경: `return new FallbackProvider(new ClaudeCliProvider(resolvedModel), new AnthropicProvider(resolvedModel), "ClaudeCLI")`
- 단, API 키가 없으면 `AnthropicProvider` 생성 시 `ConfigurationError`가 터지므로, `hasApiKey` 체크로 API 키 없을 경우 `ClaudeCliProvider` 단독 반환

패턴 (thesisVerifier.ts와 동일):
```typescript
function createClaudeProvider(model: string): LLMProvider {
  const cli = new ClaudeCliProvider(model);
  const hasApiKey = process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== "";
  if (!hasApiKey) return cli;
  return new FallbackProvider(cli, new AnthropicProvider(model), "ClaudeCLI");
}
```

### 2. `src/agent/reviewAgent.ts`

현재 구조: `client = new Anthropic()` 모듈 싱글톤 + `callWithRetry(() => client.messages.create(...))` 3곳 사용.

변경 방향: LLMProvider 인터페이스로 교체.
- `reviewReport()`, `refineSingleDraft()`, `extractSingleDraftData()` — 각각 `client.messages.create()` 호출을 `provider.call()` 로 대체
- `provider` 는 모듈 수준 싱글톤으로 생성 (thesisVerifier 패턴과 동일)
- `callWithRetry` 임포트 제거 (LLMProvider 내부에서 이미 처리)

주의점:
- `reviewAgent.ts`의 `callWithRetry`는 `Anthropic.Message` 반환 타입에 결합되어 있어 그대로 재사용 불가. provider 교체 시 응답 파싱도 함께 변경 필요.
- 현재 응답에서 `response.content.find((b) => b.type === "text")` 패턴 → `provider.call()` 결과인 `LLMCallResult.content` (string)로 단순화됨.
- `extractJson()` + JSON 파싱 로직은 그대로 유지.

### 3. `src/agent/run-debate-agent.ts`

`validateEnvironment()` 함수에서:
- 기존: `required = ["DATABASE_URL", "ANTHROPIC_API_KEY"]`
- 변경: `ANTHROPIC_API_KEY`를 required에서 제거, optional 경고로 분리

```typescript
function validateEnvironment(): void {
  const required = ["DATABASE_URL"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  // Optional: API 키 없으면 Claude CLI만 사용됨을 경고
  if (process.env.ANTHROPIC_API_KEY == null || process.env.ANTHROPIC_API_KEY === "") {
    logger.warn("Env", "ANTHROPIC_API_KEY not set — using Claude CLI only (no API fallback)");
  }
}
```

### 4. 변경 불필요 확인

- `callAgent.ts` — Round 1/2/3에서 사용하지 않음. `agentLoop.ts`에서만 사용. 변경 불필요.
- `agentLoop.ts` — 커스텀 tool-use 루프, CLI 미지원. 변경 불필요.

## 작업 계획

### Step 1 — providerFactory.ts 수정 (핵심)
- 담당: 구현팀
- 변경: Claude 모델 분기에 `createClaudeProvider()` 헬퍼 도입
- 완료 기준: `createProvider("sonnet")` 가 API 키 있을 때 `FallbackProvider`, 없을 때 `ClaudeCliProvider` 반환

### Step 2 — providerFactory.test.ts 업데이트
- 담당: 구현팀
- 현재 테스트: `'sonnet' alias → AnthropicProvider 반환` — 이 테스트는 변경 후 실패
- 변경: `FallbackProvider` 또는 `ClaudeCliProvider` 반환 검증으로 교체
- API 키 있을 때/없을 때 두 케이스 명시적 테스트
- 완료 기준: 기존 테스트 전부 통과

### Step 3 — reviewAgent.ts 수정
- 담당: 구현팀
- 변경: `Anthropic` 클라이언트 제거, LLMProvider 인터페이스로 교체
- `callWithRetry` 임포트 제거
- `response.content.find(...)` 패턴 → `result.content` (string) 로 변경
- 완료 기준: `reviewReport()`, `refineReport()`, `extractDataOnly()` 동작 동일

### Step 4 — run-debate-agent.ts 수정
- 담당: 구현팀
- 변경: `validateEnvironment()` 에서 ANTHROPIC_API_KEY 분리
- 완료 기준: API 키 없어도 프로세스 기동, logger.warn 출력 확인

### Step 5 — 통합 검증
- 담당: 검증팀
- `yarn test` 전체 통과 확인
- 특히 `providerFactory.test.ts`, `claudeCliProvider.test.ts`, `fallbackProvider.test.ts`
- 완료 기준: 테스트 커버리지 80% 이상 유지

## 리스크

### 1. AnthropicProvider 생성 시점 에러 (HIGH)
`AnthropicProvider` 생성자는 API 키가 없으면 즉시 `ConfigurationError`를 throw한다.
`FallbackProvider` 내부에서 fallback 인스턴스를 생성할 때도 같은 에러가 발생하므로, `createClaudeProvider()` 내에서 `hasApiKey` 체크 후 조건부로 생성해야 한다. 이미 thesisVerifier.ts에서 검증된 패턴.

### 2. reviewAgent.ts callWithRetry 의존성 (MEDIUM)
`callWithRetry`는 `Anthropic.Message` 타입을 직접 받는 시그니처. LLMProvider로 교체 시 재시도 로직은 `AnthropicProvider` 내부 `retry.ts`가 처리하므로 외부 callWithRetry는 불필요해짐. 그러나 CLI Provider는 별도 재시도 없음 — CLI 자체가 타임아웃 120s로 한 번만 시도. 필요 시 `ClaudeCliProvider`에 retry 래핑 추가 검토 (현재는 FallbackProvider로 커버됨).

### 3. providerFactory 테스트 케이스 변경 (LOW)
기존 테스트 3개(`sonnet`, `haiku`, `claude-*` → `AnthropicProvider`)가 실패로 바뀜. 의도적 변경이므로 테스트를 수정해야 함. 실수로 CI를 막을 수 있으니 Step 2를 Step 1 직후에 연이어 진행.

### 4. reviewAgent.ts의 모듈 수준 singleton (LOW)
현재 `const client = new Anthropic({ maxRetries: 5 })` 가 모듈 로드 시점에 생성된다. API 키가 없는 환경에서 import 시 즉시 에러가 발생할 수 있다. LLMProvider 싱글톤으로 교체 시 `createReviewProvider()` 함수로 lazy 초기화 고려.

## 의사결정 필요

없음 — 기존 thesisVerifier/fundamentalAgent 패턴이 검증된 선례. 동일 패턴 적용.
