import { logger } from "@/lib/logger";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";

/**
 * 외부 LLM Provider 장애 시 Claude(Anthropic)로 자동 폴백하는 래퍼.
 *
 * - primary 성공 → primary 결과 반환
 * - primary 실패 → warn 로그 후 fallback 호출
 * - primary + fallback 둘 다 실패 → fallback 에러 전파
 */
export class FallbackProvider implements LLMProvider {
  constructor(
    private readonly primary: LLMProvider,
    private readonly fallback: LLMProvider,
    private readonly primaryName: string,
  ) {}

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    try {
      return await this.primary.call(options);
    } catch (error) {
      this.logFallback(error);
      return this.fallback.call(options);
    }
  }

  private logFallback(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("FallbackProvider", `${this.primaryName} 실패, Claude로 폴백: ${message}`);
  }
}
