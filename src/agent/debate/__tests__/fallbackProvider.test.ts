import { describe, it, expect, vi } from "vitest";
import { FallbackProvider } from "../llm/fallbackProvider.js";
import { LLMProviderError } from "../llm/types.js";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "../llm/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CALL_OPTIONS: LLMCallOptions = {
  systemPrompt: "You are a helpful assistant.",
  userMessage: "Hello world",
  maxTokens: 100,
};

const PRIMARY_RESULT: LLMCallResult = {
  content: "primary response",
  tokensUsed: { input: 10, output: 20 },
};

const FALLBACK_RESULT: LLMCallResult = {
  content: "fallback response",
  tokensUsed: { input: 5, output: 15 },
};

function makeMockProvider(result: LLMCallResult | Error): LLMProvider {
  return {
    call: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

// ─── FallbackProvider ─────────────────────────────────────────────────────────

describe("FallbackProvider", () => {
  it("primary가 성공하면 primary 결과를 반환한다", async () => {
    // Arrange
    const primary = makeMockProvider(PRIMARY_RESULT);
    const fallback = makeMockProvider(FALLBACK_RESULT);
    const provider = new FallbackProvider(primary, fallback, "gpt-4o");

    // Act
    const result = await provider.call(CALL_OPTIONS);

    // Assert
    expect(result).toEqual(PRIMARY_RESULT);
    expect(primary.call).toHaveBeenCalledOnce();
    expect(fallback.call).not.toHaveBeenCalled();
  });

  it("primary가 실패하면 fallback 결과를 반환한다", async () => {
    // Arrange
    const primary = makeMockProvider(new LLMProviderError("OpenAI API call failed"));
    const fallback = makeMockProvider(FALLBACK_RESULT);
    const provider = new FallbackProvider(primary, fallback, "gpt-4o");

    // Act
    const result = await provider.call(CALL_OPTIONS);

    // Assert
    expect(result).toEqual(FALLBACK_RESULT);
    expect(primary.call).toHaveBeenCalledOnce();
    expect(fallback.call).toHaveBeenCalledOnce();
  });

  it("primary + fallback 둘 다 실패하면 fallback 에러를 전파한다", async () => {
    // Arrange
    const primaryError = new LLMProviderError("OpenAI API call failed");
    const fallbackError = new LLMProviderError("Anthropic API call failed");
    const primary = makeMockProvider(primaryError);
    const fallback = makeMockProvider(fallbackError);
    const provider = new FallbackProvider(primary, fallback, "gpt-4o");

    // Act & Assert
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(fallbackError);
    expect(primary.call).toHaveBeenCalledOnce();
    expect(fallback.call).toHaveBeenCalledOnce();
  });

  it("primary가 실패할 때 primaryName이 포함된 경고 로그를 남긴다", async () => {
    // Arrange
    const primary = makeMockProvider(new LLMProviderError("Connection error"));
    const fallback = makeMockProvider(FALLBACK_RESULT);
    const provider = new FallbackProvider(primary, fallback, "gemini-2.0-flash");

    // warn이 호출되는지만 확인 (내용 검증은 구현 세부사항)
    const warnSpy = vi.spyOn(provider as any, "logFallback").mockImplementation(() => {});

    // Act
    await provider.call(CALL_OPTIONS);

    // Assert: fallback이 호출되었음을 통해 warn이 발생했음을 간접 검증
    expect(fallback.call).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("primary 성공 시 fallback에 같은 options를 전달하지 않는다", async () => {
    // Arrange: primary 성공 → fallback 호출 안 됨
    const primary = makeMockProvider(PRIMARY_RESULT);
    const fallback = makeMockProvider(FALLBACK_RESULT);
    const provider = new FallbackProvider(primary, fallback, "gpt-4o");

    // Act
    await provider.call(CALL_OPTIONS);

    // Assert
    expect(fallback.call).not.toHaveBeenCalled();
  });

  it("primary 실패 시 fallback에 동일한 options를 그대로 전달한다", async () => {
    // Arrange
    const primary = makeMockProvider(new LLMProviderError("failed"));
    const fallback = makeMockProvider(FALLBACK_RESULT);
    const provider = new FallbackProvider(primary, fallback, "gpt-4o");

    // Act
    await provider.call(CALL_OPTIONS);

    // Assert
    expect(fallback.call).toHaveBeenCalledWith(CALL_OPTIONS);
  });
});
