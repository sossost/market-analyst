import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger.js";
import { DEBATE_TOOLS, executeDebateTool } from "./braveSearch.js";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 3;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 15_000; // 429 시 15초부터 시작

export interface AgentCallResult {
  content: string;
  tokensUsed: { input: number; output: number };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Rate limit (429) 대응 exponential backoff 재시도.
 * 15s → 30s → 60s 간격으로 최대 3회 재시도.
 */
export async function callWithRetry(
  fn: () => Promise<Anthropic.Message>,
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit =
        (err instanceof Error && err.message.includes("429")) ||
        (err instanceof Error && "status" in err && (err as any).status === 429);

      if (!isRateLimit || attempt === MAX_RETRIES - 1) throw err;

      const delay = BASE_DELAY_MS * 2 ** attempt;
      logger.warn("CallAgent", `Rate limited, retry ${attempt + 1}/${MAX_RETRIES} after ${(delay / 1000).toFixed(0)}s`);
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
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
    const response = await callWithRetry(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    );
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

  let lastTextContent = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callWithRetry(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: DEBATE_TOOLS,
        messages,
      }),
    );

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

    // Track text content from each response for max-rounds fallback
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    if (textBlocks.length > 0) {
      lastTextContent = textBlocks.map((b) => b.text).join("\n");
    }

    if (toolUseBlocks.length === 0) {
      return {
        content: lastTextContent,
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

  // Max rounds reached — use accumulated text or throw
  logger.warn("CallAgent", `Max tool rounds (${MAX_TOOL_ROUNDS}) reached`);
  if (lastTextContent.length > 0) {
    return {
      content: lastTextContent,
      tokensUsed: { input: totalInput, output: totalOutput },
    };
  }
  throw new Error("Max tool rounds reached with no text output");
}
