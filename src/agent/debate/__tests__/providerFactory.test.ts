import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigurationError } from "../llm/types.js";
import { createProvider } from "../llm/providerFactory.js";
import { AnthropicProvider } from "../llm/anthropicProvider.js";
import { FallbackProvider } from "../llm/fallbackProvider.js";

/**
 * createProvider 단위 테스트.
 *
 * 각 환경 변수가 설정되어 있을 때 올바른 Provider 인스턴스를 반환하는지,
 * 설정되지 않았을 때 ConfigurationError가 throw되는지 검증한다.
 */

describe("createProvider", () => {
  const saved = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = saved.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = saved.GOOGLE_GENERATIVE_AI_API_KEY;
  });

  it("'sonnet' alias → AnthropicProvider 반환", () => {
    const provider = createProvider("sonnet");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("'claude-sonnet-4-20250514' → AnthropicProvider 반환", () => {
    const provider = createProvider("claude-sonnet-4-20250514");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("'haiku' alias → AnthropicProvider 반환", () => {
    const provider = createProvider("haiku");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("'gpt-4o' → FallbackProvider 반환 (OpenAI → Anthropic 폴백)", () => {
    const provider = createProvider("gpt-4o");
    expect(provider).toBeInstanceOf(FallbackProvider);
  });

  it("'gemini-2.0-flash' → FallbackProvider 반환 (Gemini → Anthropic 폴백)", () => {
    const provider = createProvider("gemini-2.0-flash");
    expect(provider).toBeInstanceOf(FallbackProvider);
  });

  it("알 수 없는 모델명 → ConfigurationError throw", () => {
    expect(() => createProvider("unknown-model-xyz")).toThrow(ConfigurationError);
    expect(() => createProvider("unknown-model-xyz")).toThrow("Unknown model");
  });

  it("gpt 계열에서 OPENAI_API_KEY 미설정 시 ConfigurationError throw", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => createProvider("gpt-4o")).toThrow(ConfigurationError);
  });

  it("gemini 계열에서 GOOGLE_GENERATIVE_AI_API_KEY 미설정 시 ConfigurationError throw", () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    expect(() => createProvider("gemini-2.0-flash")).toThrow(ConfigurationError);
  });
});
