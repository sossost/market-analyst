import Anthropic from "@anthropic-ai/sdk";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";
import { ConfigurationError, LLMProviderError } from "./types.js";
import { callWithRetry } from "./retry.js";

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(model: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey == null || apiKey === "") {
      throw new ConfigurationError("ANTHROPIC_API_KEY is not set");
    }
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const { systemPrompt, userMessage, maxTokens = 4096 } = options;

    try {
      const response = await callWithRetry(
        () =>
          this.client.messages.create({
            model: this.model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        "AnthropicProvider",
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
    } catch (err) {
      if (err instanceof Error && err.name === "ConfigurationError") throw err;
      throw new LLMProviderError(
        `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
