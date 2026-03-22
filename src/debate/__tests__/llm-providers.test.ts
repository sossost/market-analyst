import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigurationError, LLMProviderError } from "../llm/types.js";
import { AnthropicProvider } from "../llm/anthropicProvider.js";
import { OpenAIProvider } from "../llm/openaiProvider.js";
import { GeminiProvider } from "../llm/geminiProvider.js";
import type { LLMCallOptions } from "../llm/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 테스트 중 환경 변수를 일시적으로 교체하고 복원하는 헬퍼.
 * undefined 값은 해당 키를 삭제하는 것으로 처리한다.
 */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const originals: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(vars)) {
    originals[key] = process.env[key];
    if (val == null) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, val] of Object.entries(originals)) {
      if (val == null) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}

const CALL_OPTIONS: LLMCallOptions = {
  systemPrompt: "You are a helpful assistant.",
  userMessage: "Hello world",
  maxTokens: 100,
};

// ─── AnthropicProvider ────────────────────────────────────────────────────────

describe("AnthropicProvider", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("ANTHROPIC_API_KEY 미설정 시 생성 시점에 ConfigurationError를 throw한다", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider("claude-sonnet-4-20250514")).toThrow(ConfigurationError);
    process.env.ANTHROPIC_API_KEY = originalKey ?? "test-key";
  });

  it("ANTHROPIC_API_KEY 설정 시 정상 인스턴스 생성", () => {
    expect(() => new AnthropicProvider("claude-sonnet-4-20250514")).not.toThrow();
  });

  it("SDK 오류를 LLMProviderError로 래핑한다", async () => {
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    // SDK 내부 messages.create를 mock으로 교체
    (provider as any).client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("Connection refused")),
      },
    };

    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);
    await expect(provider.call({ ...CALL_OPTIONS })).rejects.toThrow(
      "Anthropic API call failed",
    );
  });
});

// ─── OpenAIProvider ───────────────────────────────────────────────────────────

describe("OpenAIProvider", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("OPENAI_API_KEY 미설정 시 생성 시점에 ConfigurationError를 throw한다", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider("gpt-4o")).toThrow(ConfigurationError);
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("OPENAI_API_KEY 설정 시 정상 인스턴스 생성", () => {
    expect(() => new OpenAIProvider("gpt-4o")).not.toThrow();
  });

  it("정상 응답을 LLMCallResult로 변환한다", async () => {
    const provider = new OpenAIProvider("gpt-4o");
    (provider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Test response" } }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
        },
      },
    };

    const result = await provider.call(CALL_OPTIONS);
    expect(result.content).toBe("Test response");
    expect(result.tokensUsed.input).toBe(10);
    expect(result.tokensUsed.output).toBe(20);
  });

  it("SDK 오류를 LLMProviderError로 래핑한다", async () => {
    const provider = new OpenAIProvider("gpt-4o");
    (provider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("API error")),
        },
      },
    };

    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);
    await expect(provider.call({ ...CALL_OPTIONS })).rejects.toThrow("OpenAI API call failed");
  });

  it("usage가 없을 때 토큰을 0으로 반환한다", async () => {
    const provider = new OpenAIProvider("gpt-4o");
    (provider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Response" } }],
            usage: undefined,
          }),
        },
      },
    };

    const result = await provider.call(CALL_OPTIONS);
    expect(result.tokensUsed.input).toBe(0);
    expect(result.tokensUsed.output).toBe(0);
  });
});

// ─── GeminiProvider ───────────────────────────────────────────────────────────

describe("GeminiProvider", () => {
  const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  });

  it("GOOGLE_GENERATIVE_AI_API_KEY 미설정 시 생성 시점에 ConfigurationError를 throw한다", () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    expect(() => new GeminiProvider("gemini-2.0-flash")).toThrow(ConfigurationError);
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey;
  });

  it("GOOGLE_GENERATIVE_AI_API_KEY 설정 시 정상 인스턴스 생성", () => {
    expect(() => new GeminiProvider("gemini-2.0-flash")).not.toThrow();
  });

  it("정상 응답을 LLMCallResult로 변환한다", async () => {
    const provider = new GeminiProvider("gemini-2.0-flash");
    (provider as any).genAI = {
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => "Gemini response",
            usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
          },
        }),
      }),
    };

    const result = await provider.call(CALL_OPTIONS);
    expect(result.content).toBe("Gemini response");
    expect(result.tokensUsed.input).toBe(15);
    expect(result.tokensUsed.output).toBe(25);
  });

  it("SDK 오류를 LLMProviderError로 래핑한다", async () => {
    const provider = new GeminiProvider("gemini-2.0-flash");
    (provider as any).genAI = {
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockRejectedValue(new Error("Quota exceeded")),
      }),
    };

    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);
    await expect(provider.call({ ...CALL_OPTIONS })).rejects.toThrow("Gemini API call failed");
  });

  it("usageMetadata가 없을 때 토큰을 0으로 반환한다", async () => {
    const provider = new GeminiProvider("gemini-2.0-flash");
    (provider as any).genAI = {
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => "Response",
            usageMetadata: undefined,
          },
        }),
      }),
    };

    const result = await provider.call(CALL_OPTIONS);
    expect(result.tokensUsed.input).toBe(0);
    expect(result.tokensUsed.output).toBe(0);
  });
});
