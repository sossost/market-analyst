import Anthropic from "@anthropic-ai/sdk";
import { executeTool } from "./tools/index";
import { logger } from "./logger";
import type { AgentConfig, AgentResult } from "./tools/types";

/**
 * Run the Tool-use Agent loop.
 *
 * 1. Send system prompt + initial user message with tool definitions
 * 2. If Claude responds with tool_use → execute tools → feed results back
 * 3. Repeat until Claude says end_turn or max iterations reached
 * 4. Track token usage across all iterations
 */
export async function runAgentLoop(config: AgentConfig): Promise<AgentResult> {
  const client = new Anthropic();
  const startTime = Date.now();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `오늘 날짜는 ${config.targetDate}입니다. 시장 분석을 시작해 주세요.`,
    },
  ];

  const toolDefinitions = config.tools.map((t) => t.definition);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;

  for (
    let iteration = 0;
    iteration < config.maxIterations;
    iteration++
  ) {
    logger.info("Agent", `Iteration ${iteration + 1}/${config.maxIterations}`);

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Done — Claude finished naturally
    if (response.stop_reason === "end_turn") {
      logger.info("Agent", `Completed in ${iteration + 1} iterations`);
      return {
        success: true,
        tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
        toolCalls: toolCallCount,
        executionTimeMs: Date.now() - startTime,
        iterationCount: iteration + 1,
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
        tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
        toolCalls: toolCallCount,
        executionTimeMs: Date.now() - startTime,
        iterationCount: iteration + 1,
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
    tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
    toolCalls: toolCallCount,
    executionTimeMs: Date.now() - startTime,
    iterationCount: config.maxIterations,
  };
}
