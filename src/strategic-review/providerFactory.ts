/**
 * strategic-review 전용 LLM 프로바이더 팩토리
 *
 * Claude CLI를 기본으로 사용하고, ANTHROPIC_API_KEY가 설정된 경우
 * CLI → Anthropic API 순서의 FallbackProvider를 반환한다.
 *
 * qualityFilter, captureLogicAuditor, learningLoopAuditor 에서 공통 사용.
 */

import { ClaudeCliProvider } from "../agent/debate/llm/claudeCliProvider.js";
import { AnthropicProvider } from "../agent/debate/llm/anthropicProvider.js";
import { FallbackProvider } from "../agent/debate/llm/fallbackProvider.js";
import type { LLMProvider } from "../agent/debate/llm/types.js";

const FALLBACK_MODEL = "claude-sonnet-4-6-20250725";

/**
 * strategic-review용 LLM 프로바이더 생성
 *
 * ANTHROPIC_API_KEY 미설정 시: ClaudeCliProvider 단독 사용
 * ANTHROPIC_API_KEY 설정 시: ClaudeCliProvider → AnthropicProvider 폴백
 */
export function createStrategicReviewProvider(): LLMProvider {
  const cli = new ClaudeCliProvider();
  const hasApiKey =
    process.env.ANTHROPIC_API_KEY != null &&
    process.env.ANTHROPIC_API_KEY !== "";
  if (!hasApiKey) return cli;
  return new FallbackProvider(cli, new AnthropicProvider(FALLBACK_MODEL), "ClaudeCLI");
}
