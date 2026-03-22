import { logger } from "@/lib/logger";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Rate limit 에러인지 판정.
 * - HTTP 429 (Anthropic, OpenAI)
 * - Gemini RESOURCE_EXHAUSTED
 */
function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("429") ||
    err.message.toLowerCase().includes("resource_exhausted") ||
    ("status" in err && (err as { status: unknown }).status === 429)
  );
}

/**
 * Rate limit 발생 시 지수 백오프로 재시도.
 * @param fn - 호출할 비동기 함수
 * @param context - 로그에 표시할 컨텍스트 이름 (예: "AnthropicProvider")
 */
export async function callWithRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === MAX_RETRIES - 1) throw err;

      const delay = BASE_DELAY_MS * 2 ** attempt;
      logger.warn(
        context,
        `Rate limited, retry ${attempt + 1}/${MAX_RETRIES} after ${(delay / 1000).toFixed(0)}s`,
      );
      await sleep(delay);
    }
  }
  // MAX_RETRIES === 0인 경우의 안전망 (실제 도달 불가)
  throw new Error("Unreachable");
}
