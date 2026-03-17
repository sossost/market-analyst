import { AnthropicProvider } from "./anthropicProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { FallbackProvider } from "./fallbackProvider.js";
import type { LLMProvider } from "./types.js";
import { ConfigurationError } from "./types.js";

/**
 * model string → LLMProvider 인스턴스 매핑.
 *
 * - "claude-*" 또는 "sonnet" 접두어/포함 문자열 → AnthropicProvider (폴백 없음)
 * - "gpt-*" → FallbackProvider(OpenAIProvider → AnthropicProvider)
 * - "gemini-*" → FallbackProvider(GeminiProvider → AnthropicProvider)
 *
 * API Key 미설정 시 Provider 생성 시점에서 즉시 ConfigurationError.
 */
export function createProvider(model: string): LLMProvider {
  const normalizedModel = model.trim().toLowerCase();

  if (
    normalizedModel.startsWith("claude-") ||
    normalizedModel === "sonnet" ||
    normalizedModel === "haiku" ||
    normalizedModel === "opus"
  ) {
    const resolvedModel = resolveAnthropicModel(model.trim());
    return new AnthropicProvider(resolvedModel);
  }

  if (normalizedModel.startsWith("gpt-")) {
    const fallbackModel = resolveAnthropicModel("sonnet");
    return new FallbackProvider(
      new OpenAIProvider(model.trim()),
      new AnthropicProvider(fallbackModel),
      model.trim(),
    );
  }

  if (normalizedModel.startsWith("gemini-")) {
    const fallbackModel = resolveAnthropicModel("sonnet");
    return new FallbackProvider(
      new GeminiProvider(model.trim()),
      new AnthropicProvider(fallbackModel),
      model.trim(),
    );
  }

  throw new ConfigurationError(
    `Unknown model "${model}". Supported prefixes: claude-*, gpt-*, gemini-*, or aliases sonnet/haiku/opus`,
  );
}

/**
 * agent 파일 frontmatter에서 short alias (sonnet/haiku/opus)가 오는 경우
 * 실제 Anthropic 모델 ID로 변환.
 */
function resolveAnthropicModel(model: string): string {
  const ALIAS_MAP: Record<string, string> = {
    sonnet: "claude-sonnet-4-20250514",
    haiku: "claude-haiku-4-20250514",
    opus: "claude-opus-4-20250514",
  };
  return ALIAS_MAP[model.toLowerCase()] ?? model;
}
