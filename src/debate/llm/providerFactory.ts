import { ClaudeCliProvider } from "./claudeCliProvider.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { FallbackProvider } from "./fallbackProvider.js";
import type { LLMProvider } from "./types.js";
import { ConfigurationError } from "./types.js";

/**
 * model alias → Anthropic API model name.
 * ClaudeCliProvider는 CLI가 모델명을 해석하지만,
 * AnthropicProvider(API 직접 호출)는 정규 모델명이 필요하다.
 */
function resolveClaudeModelId(alias: string): string {
  switch (alias) {
    case "sonnet":
      return "claude-sonnet-4-6";
    case "haiku":
      return "claude-haiku-4-5-20251001";
    case "opus":
      return "claude-opus-4-6";
    default:
      return alias; // already fully qualified (e.g. "claude-sonnet-4-6")
  }
}

/**
 * model string → LLMProvider 인스턴스 매핑.
 *
 * - "claude-*" 또는 sonnet/haiku/opus alias
 *   → ClaudeCliProvider 우선. ANTHROPIC_API_KEY 존재 시 AnthropicProvider 폴백.
 *     CLI 인증 만료 시 API 과금 폴백으로 파이프라인 전체 정지 방지.
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
    const cli = new ClaudeCliProvider();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey != null && apiKey !== "") {
      const apiModelId = resolveClaudeModelId(normalizedModel);
      return new FallbackProvider(
        cli,
        new AnthropicProvider(apiModelId),
        `claude-cli(${apiModelId})`,
      );
    }
    return cli;
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
