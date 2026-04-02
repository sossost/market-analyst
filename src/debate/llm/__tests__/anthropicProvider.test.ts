import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMCallOptions } from "../types.js";

const CALL_OPTIONS: LLMCallOptions = {
  systemPrompt: "You are a helpful assistant.",
  userMessage: "Hello world",
  maxTokens: 100,
};

function makeSuccessResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text", text: "Response text" }],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      ...overrides,
    },
    stop_reason: "end_turn",
  };
}

const createSpy = vi.fn();

vi.mock("@/lib/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy } }),
}));

describe("AnthropicProvider — 프롬프트 캐싱", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    createSpy.mockReset();
  });

  it("system 파라미터가 TextBlockParam[] 형태로 전달된다", async () => {
    const { AnthropicProvider } = await import("../anthropicProvider.js");
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    createSpy.mockResolvedValue(makeSuccessResponse());

    await provider.call(CALL_OPTIONS);

    const callArgs = createSpy.mock.calls[0][0];
    const system = callArgs.system;

    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(1);
    expect(system[0].type).toBe("text");
    expect(system[0].text).toBe(CALL_OPTIONS.systemPrompt);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("mock response에 cache_creation_input_tokens: 500 포함 시 tokensUsed.cacheCreation === 500", async () => {
    const { AnthropicProvider } = await import("../anthropicProvider.js");
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    createSpy.mockResolvedValue(
      makeSuccessResponse({ cache_creation_input_tokens: 500 }),
    );

    const result = await provider.call(CALL_OPTIONS);

    expect(result.tokensUsed.cacheCreation).toBe(500);
    expect(result.tokensUsed.cacheRead).toBeUndefined();
  });

  it("mock response에 cache_read_input_tokens: 300 포함 시 tokensUsed.cacheRead === 300", async () => {
    const { AnthropicProvider } = await import("../anthropicProvider.js");
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    createSpy.mockResolvedValue(
      makeSuccessResponse({ cache_read_input_tokens: 300 }),
    );

    const result = await provider.call(CALL_OPTIONS);

    expect(result.tokensUsed.cacheRead).toBe(300);
    expect(result.tokensUsed.cacheCreation).toBeUndefined();
  });

  it("mock response에 캐시 필드 없을 때 cacheCreation/cacheRead 모두 undefined", async () => {
    const { AnthropicProvider } = await import("../anthropicProvider.js");
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    createSpy.mockResolvedValue(makeSuccessResponse());

    const result = await provider.call(CALL_OPTIONS);

    expect(result.tokensUsed.cacheCreation).toBeUndefined();
    expect(result.tokensUsed.cacheRead).toBeUndefined();
  });

  it("cache_creation_input_tokens: 0 일 때 cacheCreation은 undefined (0 미포함)", async () => {
    const { AnthropicProvider } = await import("../anthropicProvider.js");
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    createSpy.mockResolvedValue(
      makeSuccessResponse({ cache_creation_input_tokens: 0 }),
    );

    const result = await provider.call(CALL_OPTIONS);

    expect(result.tokensUsed.cacheCreation).toBeUndefined();
  });

  it("input/output 토큰은 항상 반환된다", async () => {
    const { AnthropicProvider } = await import("../anthropicProvider.js");
    const provider = new AnthropicProvider("claude-sonnet-4-20250514");
    createSpy.mockResolvedValue(
      makeSuccessResponse({ cache_creation_input_tokens: 500, cache_read_input_tokens: 100 }),
    );

    const result = await provider.call(CALL_OPTIONS);

    expect(result.tokensUsed.input).toBe(10);
    expect(result.tokensUsed.output).toBe(20);
    expect(result.tokensUsed.cacheCreation).toBe(500);
    expect(result.tokensUsed.cacheRead).toBe(100);
  });
});
