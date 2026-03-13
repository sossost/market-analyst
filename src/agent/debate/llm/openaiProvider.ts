import OpenAI from "openai";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";
import { ConfigurationError, LLMProviderError } from "./types.js";
import { callWithRetry } from "./retry.js";

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(model: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey == null || apiKey === "") {
      throw new ConfigurationError("OPENAI_API_KEY is not set");
    }
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const { systemPrompt, userMessage, maxTokens = 4096 } = options;

    try {
      const response = await callWithRetry(
        () =>
          this.client.chat.completions.create({
            model: this.model,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
          }),
        "OpenAIProvider",
      );

      const choice = response.choices[0];
      const content = choice?.message?.content ?? "";
      const usage = response.usage;

      return {
        content,
        tokensUsed: {
          input: usage?.prompt_tokens ?? 0,
          output: usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "ConfigurationError") throw err;
      throw new LLMProviderError(
        `OpenAI API call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
