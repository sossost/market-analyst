import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigurationError } from "../llm/types.js";
import { createProvider } from "../llm/providerFactory.js";
import { ClaudeCliProvider } from "../llm/claudeCliProvider.js";
import { FallbackProvider } from "../llm/fallbackProvider.js";

/**
 * createProvider 단위 테스트.
 *
 * Claude 계열: API 키 유무와 무관하게 항상 ClaudeCliProvider 단독 반환.
 * GPT/Gemini 계열: 항상 FallbackProvider(원본 → ClaudeCliProvider 폴백).
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

  describe("Claude 계열 — API 키 유무와 무관하게 ClaudeCliProvider 단독", () => {
    it("'sonnet' + API 키 있음 → ClaudeCliProvider 반환", () => {
      const provider = createProvider("sonnet");
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
    });

    it("'claude-sonnet-4-20250514' + API 키 있음 → ClaudeCliProvider 반환", () => {
      const provider = createProvider("claude-sonnet-4-20250514");
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
    });

    it("'haiku' + API 키 있음 → ClaudeCliProvider 반환", () => {
      const provider = createProvider("haiku");
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
    });

    it("'opus' + API 키 있음 → ClaudeCliProvider 반환", () => {
      const provider = createProvider("opus");
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
    });

    it("'sonnet' + API 키 없음 → ClaudeCliProvider 반환", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = createProvider("sonnet");
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
    });

    it("'opus' + API 키 빈 문자열 → ClaudeCliProvider 반환", () => {
      process.env.ANTHROPIC_API_KEY = "";
      const provider = createProvider("opus");
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
    });
  });

  describe("GPT 계열 — 항상 FallbackProvider(OpenAI → ClaudeCliProvider)", () => {
    it("'gpt-4o' → FallbackProvider 반환", () => {
      const provider = createProvider("gpt-4o");
      expect(provider).toBeInstanceOf(FallbackProvider);
    });

    it("ANTHROPIC_API_KEY 없어도 FallbackProvider 반환 (CLI 폴백)", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = createProvider("gpt-4o");
      expect(provider).toBeInstanceOf(FallbackProvider);
    });

    it("gpt 계열에서 OPENAI_API_KEY 미설정 시 ConfigurationError throw", () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => createProvider("gpt-4o")).toThrow(ConfigurationError);
    });
  });

  describe("Gemini 계열 — 항상 FallbackProvider(Gemini → ClaudeCliProvider)", () => {
    it("'gemini-2.0-flash' → FallbackProvider 반환", () => {
      const provider = createProvider("gemini-2.0-flash");
      expect(provider).toBeInstanceOf(FallbackProvider);
    });

    it("ANTHROPIC_API_KEY 없어도 FallbackProvider 반환 (CLI 폴백)", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = createProvider("gemini-2.0-flash");
      expect(provider).toBeInstanceOf(FallbackProvider);
    });

    it("gemini 계열에서 GOOGLE_GENERATIVE_AI_API_KEY 미설정 시 ConfigurationError throw", () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      expect(() => createProvider("gemini-2.0-flash")).toThrow(ConfigurationError);
    });
  });

  describe("공통", () => {
    it("알 수 없는 모델명 → ConfigurationError throw", () => {
      expect(() => createProvider("unknown-model-xyz")).toThrow(ConfigurationError);
      expect(() => createProvider("unknown-model-xyz")).toThrow("Unknown model");
    });
  });
});
