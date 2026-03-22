import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";
import { ConfigurationError, LLMProviderError } from "./types.js";
import { callWithRetry } from "./retry.js";

export class GeminiProvider implements LLMProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: string;

  constructor(model: string) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (apiKey == null || apiKey === "") {
      throw new ConfigurationError("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const { systemPrompt, userMessage, maxTokens = 4096 } = options;

    try {
      const generativeModel = this.genAI.getGenerativeModel({
        model: this.model,
        systemInstruction: systemPrompt,
      });

      const response = await callWithRetry(
        () =>
          generativeModel.generateContent({
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        "GeminiProvider",
      );

      const text = response.response.text();
      const usageMetadata = response.response.usageMetadata;

      return {
        content: text,
        tokensUsed: {
          input: usageMetadata?.promptTokenCount ?? 0,
          output: usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "ConfigurationError") throw err;
      throw new LLMProviderError(
        `Gemini API call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
