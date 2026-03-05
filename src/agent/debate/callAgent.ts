import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger.js";
import { DEBATE_TOOLS, executeDebateTool } from "./braveSearch.js";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 5;

export interface AgentCallResult {
  content: string;
  tokensUsed: { input: number; output: number };
}

/**
 * Claude API call with tool-use loop.
 * Agents can use web_search and news_search to gather real-time data.
 * Loops up to MAX_TOOL_ROUNDS times if tool calls are requested.
 */
export async function callAgent(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; disableTools?: boolean },
): Promise<AgentCallResult> {
  const maxTokens = options?.maxTokens ?? MAX_TOKENS;
  const useTools = options?.disableTools !== true;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let totalInput = 0;
  let totalOutput = 0;

  // 도구 없이 단일 호출
  if (!useTools) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    return {
      content: textBlocks.map((b) => b.text).join("\n"),
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: DEBATE_TOOLS,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    // If no tool use, extract text and return
    if (response.stop_reason === "end_turn") {
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      return {
        content: textBlocks.map((b) => b.text).join("\n"),
        tokensUsed: { input: totalInput, output: totalOutput },
      };
    }

    // Handle tool calls
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls and not end_turn — extract whatever text we got
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      return {
        content: textBlocks.map((b) => b.text).join("\n"),
        tokensUsed: { input: totalInput, output: totalOutput },
      };
    }

    // Append assistant response
    messages.push({ role: "assistant", content: response.content });

    // Execute tools in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        logger.info("DebateTool", `${block.name}: ${JSON.stringify(block.input).slice(0, 80)}`);
        const result = await executeDebateTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result,
        };
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  // Max rounds reached — extract text from last response
  logger.warn("CallAgent", `Max tool rounds (${MAX_TOOL_ROUNDS}) reached`);
  return {
    content: "[분석 완료 — 검색 라운드 한도 도달]",
    tokensUsed: { input: totalInput, output: totalOutput },
  };
}
