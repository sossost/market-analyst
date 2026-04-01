import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/anthropic-client";
import { executeTool } from "@/tools/index";
import { callWithRetry } from "@/debate/callAgent.js";
import { logger } from "@/lib/logger";
import type { AgentConfig, AgentResult, ToolError } from "@/tools/types";

/**
 * Parse a tool result string for an error JSON pattern.
 * Returns the error message if found, null otherwise.
 */
function parseToolError(result: string): string | null {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON — not an error pattern
  }
  return null;
}

/**
 * Run the Tool-use Agent loop.
 *
 * 1. Send system prompt + initial user message with tool definitions
 * 2. If Claude responds with tool_use → execute tools → feed results back
 * 3. Repeat until Claude says end_turn or max iterations reached
 * 4. Track token usage across all iterations
 *
 * Prompt Caching: system prompt + tool definitions are cached to reduce
 * input token costs by ~90% on iterations 2+.
 */
export async function runAgentLoop(config: AgentConfig): Promise<AgentResult> {
  const client = getAnthropicClient();
  const startTime = Date.now();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `오늘 날짜는 ${config.targetDate}입니다. 시장 분석을 시작해 주세요.`,
    },
  ];

  // Prompt Caching: system prompt as ContentBlock with cache_control
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: config.systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  // Prompt Caching: cache_control on last tool definition
  const toolDefinitions = config.tools.map((t) => t.definition);
  const cachedTools: Anthropic.Tool[] = toolDefinitions.map((t, i) =>
    i === toolDefinitions.length - 1
      ? { ...t, cache_control: { type: "ephemeral" as const } }
      : t,
  );

  const CRITICAL_TOOLS = new Set([
    "get_market_breadth",
    "get_leading_sectors",
    "get_index_returns",
  ]);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let toolCallCount = 0;
  const collectedToolErrors: ToolError[] = [];

  for (
    let iteration = 0;
    iteration < config.maxIterations;
    iteration++
  ) {
    logger.info("Agent", `Iteration ${iteration + 1}/${config.maxIterations}`);

    const response = await callWithRetry(() =>
      client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: 0,
        system: systemBlocks,
        tools: cachedTools,
        messages,
      }),
    );

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    const usage = response.usage as unknown as Record<string, number>;
    cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    cacheReadTokens += usage.cache_read_input_tokens ?? 0;

    // Done — Claude finished naturally
    if (response.stop_reason === "end_turn") {
      logger.info("Agent", `Completed in ${iteration + 1} iterations`);
      return {
        success: true,
        tokensUsed: { input: totalInputTokens, output: totalOutputTokens, cacheCreation: cacheCreationTokens, cacheRead: cacheReadTokens },
        toolCalls: toolCallCount,
        executionTimeMs: Date.now() - startTime,
        iterationCount: iteration + 1,
        ...(collectedToolErrors.length > 0 && { toolErrors: collectedToolErrors }),
      };
    }

    // Claude wants to use tools
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls and not end_turn — unexpected, treat as done
      logger.warn("Agent", `Unexpected stop_reason: ${response.stop_reason}`);
      return {
        success: true,
        tokensUsed: { input: totalInputTokens, output: totalOutputTokens, cacheCreation: cacheCreationTokens, cacheRead: cacheReadTokens },
        toolCalls: toolCallCount,
        executionTimeMs: Date.now() - startTime,
        iterationCount: iteration + 1,
        ...(collectedToolErrors.length > 0 && { toolErrors: collectedToolErrors }),
      };
    }

    // Append assistant response (preserves tool_use blocks)
    messages.push({ role: "assistant", content: response.content });

    // Execute tools in parallel and collect results
    const toolResultPromises = toolUseBlocks.map(async (block) => {
      logger.info("Agent", `Tool call: ${block.name}`);
      const result = await executeTool(
        config.tools,
        block.name,
        block.input as Record<string, unknown>,
      );

      // Detect tool errors from JSON response
      const toolError = parseToolError(result);
      if (toolError != null) {
        const isCritical = CRITICAL_TOOLS.has(block.name);
        const severity = isCritical ? "CRITICAL" : "WARN";
        logger.warn("Agent", `[${severity}] Tool error from ${block.name}: ${toolError}`);

        collectedToolErrors.push({
          toolName: block.name,
          error: toolError,
          input: block.input as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: result,
      };
    });

    const toolResults: Anthropic.ToolResultBlockParam[] =
      await Promise.all(toolResultPromises);
    toolCallCount += toolUseBlocks.length;

    // Send tool results back
    messages.push({ role: "user", content: toolResults });
  }

  // Exceeded max iterations
  logger.error("Agent", `Max iterations (${config.maxIterations}) reached`);
  return {
    success: false,
    error: `Max iterations (${config.maxIterations}) reached`,
    tokensUsed: { input: totalInputTokens, output: totalOutputTokens, cacheCreation: cacheCreationTokens, cacheRead: cacheReadTokens },
    toolCalls: toolCallCount,
    executionTimeMs: Date.now() - startTime,
    iterationCount: config.maxIterations,
    ...(collectedToolErrors.length > 0 && { toolErrors: collectedToolErrors }),
  };
}
