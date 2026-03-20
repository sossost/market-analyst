import { AnthropicProvider } from "./anthropicProvider.js";
import { ClaudeCliProvider } from "./claudeCliProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { FallbackProvider } from "./fallbackProvider.js";
import type { LLMProvider } from "./types.js";
import { ConfigurationError } from "./types.js";
import { CLAUDE_SONNET, CLAUDE_HAIKU, CLAUDE_OPUS } from "@/lib/models.js";

/**
 * model string → LLMProvider 인스턴스 매핑.
 *
 * - "claude-*" 또는 sonnet/haiku/opus alias → ClaudeCliProvider 단독 (API 폴백 없음).
 *   CLI 실패 시 에러를 던져 조용한 API 과금을 방지.
 * - "gpt-*" → OpenAIProvider. API 키 있으면 Anthropic 폴백 추가.
 * - "gemini-*" → GeminiProvider. API 키 있으면 Anthropic 폴백 추가.
 */
export function createProvider(model: string): LLMProvider {
  const normalizedModel = model.trim().toLowerCase();

  if (
    normalizedModel.startsWith("claude-") ||
    normalizedModel === "sonnet" ||
    normalizedModel === "haiku" ||
    normalizedModel === "opus"
  ) {
    return createClaudeProvider();
  }

  if (normalizedModel.startsWith("gpt-")) {
    const openAiProvider = new OpenAIProvider(model.trim());
    const hasApiKey = hasAnthropicApiKey();
    if (!hasApiKey) return openAiProvider;
    const fallbackModel = resolveAnthropicModel("sonnet");
    return new FallbackProvider(
      openAiProvider,
      new AnthropicProvider(fallbackModel),
      model.trim(),
    );
  }

  if (normalizedModel.startsWith("gemini-")) {
    const geminiProvider = new GeminiProvider(model.trim());
    const hasApiKey = hasAnthropicApiKey();
    if (!hasApiKey) return geminiProvider;
    const fallbackModel = resolveAnthropicModel("sonnet");
    return new FallbackProvider(
      geminiProvider,
      new AnthropicProvider(fallbackModel),
      model.trim(),
    );
  }

  throw new ConfigurationError(
    `Unknown model "${model}". Supported prefixes: claude-*, gpt-*, gemini-*, or aliases sonnet/haiku/opus`,
  );
}

/**
 * Claude 계열 모델용 provider — CLI 단독.
 * API 키 유무와 무관하게 항상 ClaudeCliProvider만 사용.
 * CLI 실패 시 에러를 던져 조용한 API 과금을 방지.
 */
function createClaudeProvider(): LLMProvider {
  return new ClaudeCliProvider();
}

function hasAnthropicApiKey(): boolean {
  return process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== "";
}

/**
 * agent 파일 frontmatter에서 short alias (sonnet/haiku/opus)가 오는 경우
 * 실제 Anthropic 모델 ID로 변환.
 */
function resolveAnthropicModel(model: string): string {
  const ALIAS_MAP: Record<string, string> = {
    sonnet: CLAUDE_SONNET,
    haiku: CLAUDE_HAIKU,
    opus: CLAUDE_OPUS,
  };
  return ALIAS_MAP[model.toLowerCase()] ?? model;
}
