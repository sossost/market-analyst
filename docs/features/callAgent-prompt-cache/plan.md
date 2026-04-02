# callAgent 프롬프트 캐싱 추가

## 선행 맥락

메모리 검색 결과 없음. 단, `agentLoop.ts`에 동일한 패턴이 이미 구현되어 있어
그것을 레퍼런스로 사용한다.

## 골 정렬

SUPPORT — 직접 포착 기능이 아니라 인프라 비용 절감. 토론 엔진이 더 많은
호출을 감당할 수 있게 되어 포착 품질 유지에 간접 기여.

## 문제

토론 엔진에서 Anthropic API를 직접 호출하는 경로들이 `system` 파라미터에
프롬프트 캐싱을 적용하지 않아, 동일한 시스템 프롬프트가 매 호출마다 full
입력 토큰으로 과금되고 있다.

## Before → After

**Before**: `system: systemPrompt` (string) — 매 호출마다 전체 토큰 과금.

**After**: `system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]`
(TextBlockParam[]) — 첫 호출에 캐시 생성, 이후 5분 내 재호출 시 캐시 히트.
캐시 토큰은 input 토큰 대비 ~10% 비용.

## 코드베이스 현황 (조사 결과)

이슈는 `callAgent.ts`의 `callAgent()` 함수를 지목했지만, 실제 외부 호출처가
없다 (`agentLoop.ts`, `corporateAnalyst.ts`는 `callWithRetry`만 import).
`callAgent()` 함수 자체는 현재 dead code에 가깝다.

실제 Anthropic API 직접 호출 활성 경로:
1. `src/debate/llm/anthropicProvider.ts` — `AnthropicProvider.call()`:
   `run-weekly-qa`(폴백), `fundamentalAgent`(폴백)에서 사용.
2. `src/debate/callAgent.ts` — `callAgent()` 함수:
   현재 외부 호출처 없음. 향후 복원 가능성을 고려해 함께 수정.

토론 Round 1/2/3의 메인 경로는 `ClaudeCliProvider`(Claude Max CLI)이므로
API 직접 과금이 발생하지 않는다. 프롬프트 캐싱 적용 대상은 API 폴백 경로다.

## 변경 사항

### 1. `src/debate/llm/anthropicProvider.ts` (핵심)

`system: systemPrompt` → `system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]`

캐시 토큰 로깅 추가:
```typescript
const usage = response.usage as unknown as Record<string, number>;
const cacheCreation = usage.cache_creation_input_tokens ?? 0;
const cacheRead = usage.cache_read_input_tokens ?? 0;

if (cacheCreation > 0 || cacheRead > 0) {
  logger.info("AnthropicProvider", `Cache — creation: ${cacheCreation}, read: ${cacheRead}`);
}
```

반환 타입 `LLMCallResult.tokensUsed`에 캐시 필드 추가:
```typescript
// src/debate/llm/types.ts
tokensUsed: {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
};
```

### 2. `src/debate/callAgent.ts` (dead code 정비)

`callAgent()` 함수의 `system: systemPrompt` 두 곳(useTools=false 분기, 루프 내)을
동일하게 TextBlockParam[] 형태로 변경. 캐시 토큰 로깅 추가.

`AgentCallResult.tokensUsed`에 `cacheCreation?: number`, `cacheRead?: number` 필드 추가.

### 3. 의존성 없음

`agentLoop.ts`는 이미 캐싱 적용 완료. 변경 불필요.
`LLMCallResult` 타입 변경은 optional 필드이므로 기존 호출부(round1, round2,
debateEngine 등) 파괴적 변경 없음.

## 테스트 방법

### 자동 테스트 (필수)

`src/debate/llm/__tests__/anthropicProvider.test.ts` 신규 작성:

```
- mock response에 cache_creation_input_tokens: 500 포함 시
  tokensUsed.cacheCreation === 500 반환 확인
- mock response에 캐시 필드 없을 때 cacheCreation === undefined (또는 0) 확인
- system 파라미터가 TextBlockParam[] 형태로 전달되는지 확인
  (client.messages.create 호출 인자 spy)
```

### 수동 검증 (선택)

Anthropic 대시보드 또는 로그에서 확인:
- 첫 호출: `Cache — creation: N, read: 0` 로그 출력
- 5분 내 동일 system prompt 재호출: `Cache — creation: 0, read: N` 로그 출력
- `run-weekly-qa`를 실제 실행하고 로그에서 캐시 히트 여부 확인

캐시 히트 조건: system prompt가 1,024 tokens 이상이어야 Anthropic이 캐싱을
활성화한다. 시스템 프롬프트가 짧으면 히트 없이도 무해하게 동작한다.

## 완료 기준

- [ ] `AnthropicProvider.call()`의 `system` 파라미터가 TextBlockParam[] 형태로 전달됨
- [ ] `callAgent()` 함수의 `system` 파라미터 동일하게 변경
- [ ] `LLMCallResult.tokensUsed`에 `cacheCreation?`, `cacheRead?` 옵셔널 필드 추가
- [ ] `AgentCallResult.tokensUsed`에 동일 필드 추가
- [ ] 캐시 토큰 > 0 시 logger.info 출력
- [ ] `anthropicProvider.test.ts` 신규 테스트 통과
- [ ] 기존 테스트 전체 통과 (파괴적 변경 없음)
- [ ] TypeScript 컴파일 에러 없음

## 리스크

- **캐시 미작동**: system prompt가 1,024 tokens 미만이면 Anthropic이 캐싱을
  활성화하지 않는다. 기능 에러가 아니라 조용히 무시되므로 코드 동작에는 영향 없음.
- **베타 헤더 누락 (조치 필요)**: `getAnthropicClient()`가 `anthropic-beta: prompt-caching-2024-07-31`
  헤더를 설정하지 않는다. `agentLoop.ts`에서 이미 캐싱이 작동 중이므로
  최신 Anthropic SDK(1.x 이상)에서는 헤더 없이도 캐싱이 지원될 가능성이 높다.
  구현 전 SDK 버전 확인 후 필요 시 `defaultHeaders` 추가:
  ```typescript
  instance = new Anthropic({
    maxRetries: 5,
    defaultHeaders: { "anthropic-beta": "prompt-caching-2024-07-31" },
  });
  ```
  단, `agentLoop.ts`에서 이미 동작한다면 변경 불필요.

## 의사결정 필요

없음 — 바로 구현 가능.
