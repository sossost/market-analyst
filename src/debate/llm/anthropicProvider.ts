import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/anthropic-client";
import { logger } from "@/lib/logger";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";
import { ConfigurationError, LLMProviderError } from "./types.js";
import { callWithRetry } from "./retry.js";

type CacheableUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(model: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey == null || apiKey === "") {
      throw new ConfigurationError("ANTHROPIC_API_KEY is not set");
    }
    this.client = getAnthropicClient();
    this.model = model;
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const { systemPrompt, userMessage, maxTokens = 4096 } = options;

    const systemBlocks: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];

    try {
      const response = await callWithRetry(
        () =>
          this.client.messages.create({
            model: this.model,
            max_tokens: maxTokens,
            system: systemBlocks,
            messages: [{ role: "user", content: userMessage }],
          }),
        "AnthropicProvider",
      );

      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      const usage = response.usage as unknown as CacheableUsage;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;

      if (cacheCreation > 0 || cacheRead > 0) {
        logger.info("AnthropicProvider", `Cache — creation: ${cacheCreation}, read: ${cacheRead}`);
      }

      return {
        content: textBlocks.map((b) => b.text).join("\n"),
        tokensUsed: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          ...(cacheCreation > 0 && { cacheCreation }),
          ...(cacheRead > 0 && { cacheRead }),
        },
      };
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new LLMProviderError(
        `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
