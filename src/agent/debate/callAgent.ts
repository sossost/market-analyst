import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger.js";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

export interface AgentCallResult {
  content: string;
  tokensUsed: { input: number; output: number };
}

/**
 * Single Claude API call — no tool-use loop, just system + user → text response.
 */
export async function callAgent(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
): Promise<AgentCallResult> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  const content = textBlocks.map((b) => b.text).join("\n");

  return {
    content,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
