import { ClaudeCliProvider } from "./claudeCliProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { FallbackProvider } from "./fallbackProvider.js";
import type { LLMProvider } from "./types.js";
import { ConfigurationError } from "./types.js";

/**
 * model string → LLMProvider 인스턴스 매핑.
 *
 * - "claude-*" 또는 sonnet/haiku/opus alias → ClaudeCliProvider (API 폴백 없음)
 * - "gpt-*" → OpenAIProvider. 실패 시 ClaudeCliProvider 폴백.
 * - "gemini-*" → GeminiProvider. 실패 시 ClaudeCliProvider 폴백.
 */
export function createProvider(model: string): LLMProvider {
  const normalizedModel = model.trim().toLowerCase();

  if (
    normalizedModel.startsWith("claude-") ||
    normalizedModel === "sonnet" ||
    normalizedModel === "haiku" ||
    normalizedModel === "opus"
  ) {
    return new ClaudeCliProvider();
  }

  if (normalizedModel.startsWith("gpt-")) {
    return new FallbackProvider(
      new OpenAIProvider(model.trim()),
      new ClaudeCliProvider(),
      model.trim(),
    );
  }

  if (normalizedModel.startsWith("gemini-")) {
    return new FallbackProvider(
      new GeminiProvider(model.trim()),
      new ClaudeCliProvider(),
      model.trim(),
    );
  }

  throw new ConfigurationError(
    `Unknown model "${model}". Supported prefixes: claude-*, gpt-*, gemini-*, or aliases sonnet/haiku/opus`,
  );
}
