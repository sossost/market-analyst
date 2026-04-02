export interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LLMCallResult {
  content: string;
  tokensUsed: {
    input: number;
    output: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
}

export interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMCallResult>;
}

/**
 * API Key 미설정 등 구성 오류. Provider 생성 시점에서 throw.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * 외부 LLM API 호출 오류. Provider 내부에서 래핑하여 throw.
 * debateEngine의 Promise.allSettled 내성이 그대로 동작하도록 단일 에러 타입으로 통일.
 */
export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMProviderError";
  }
}
