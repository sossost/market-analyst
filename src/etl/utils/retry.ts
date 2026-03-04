export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay =
    options.baseDelay * Math.pow(options.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelay);

  if (options.jitter) {
    const jitterRange = cappedDelay * 0.25;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, cappedDelay + jitter);
  }

  return cappedDelay;
}

function isRetryableError(error: unknown): boolean {
  const err = error as Record<string, unknown>;

  // Network errors
  if (
    err.code === "ECONNRESET" ||
    err.code === "ENOTFOUND" ||
    err.code === "ECONNREFUSED" ||
    err.code === "ETIMEDOUT"
  ) {
    return true;
  }

  // PostgreSQL transient errors
  if (
    err.code === "XX000" ||
    err.code === "57P01" ||
    (typeof err.code === "string" && err.code.startsWith("57P")) ||
    err.code === "08003" ||
    err.code === "08006" ||
    err.code === "08001"
  ) {
    return true;
  }

  // HTTP status codes (5xx, 429 Too Many Requests, 408 Request Timeout)
  const status = (err as Record<string, Record<string, unknown>>).response
    ?.status as number | undefined;
  if (status != null && (status >= 500 || status === 429 || status === 408)) {
    return true;
  }

  // Timeout / connection errors
  const message = err.message as string | undefined;
  if (
    message?.includes("timeout") ||
    message?.includes("canceled") ||
    message?.includes("connection terminated") ||
    message?.includes("connection closed") ||
    message?.includes("server closed the connection") ||
    message?.includes("rate limit") ||
    message?.includes("quota exceeded")
  ) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const data = await fn();
      return { success: true, data, attempts: attempt, totalTime: Date.now() - startTime };
    } catch (error) {
      lastError = error as Error;

      if (!isRetryableError(error) || attempt === opts.maxAttempts) {
        return {
          success: false,
          error: lastError,
          attempts: attempt,
          totalTime: Date.now() - startTime,
        };
      }

      const delay = calculateDelay(attempt, opts);
      console.warn(`Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms... (${lastError.message})`);
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
    totalTime: Date.now() - startTime,
  };
}

export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const result = await withRetry(operation, options);

  if (!result.success) {
    const err = result.error as Record<string, unknown> | undefined;
    const code = err?.code ? ` [${err.code}]` : "";
    throw new Error(`DB operation failed after ${result.attempts} attempts${code}: ${err?.message ?? "unknown"}`);
  }

  return result.data as T;
}

export async function retryApiCall<T>(
  apiCall: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const result = await withRetry(apiCall, options);

  if (!result.success) {
    throw new Error(
      `API call failed after ${result.attempts} attempts: ${result.error?.message ?? "unknown"}`,
    );
  }

  return result.data as T;
}

export async function retryBatchOperation<T>(
  items: T[],
  operation: (item: T) => Promise<void>,
  options: Partial<RetryOptions> = {},
): Promise<{ success: T[]; failed: { item: T; error: Error }[] }> {
  const success: T[] = [];
  const failed: { item: T; error: Error }[] = [];

  for (const item of items) {
    try {
      await retryApiCall(() => operation(item), options);
      success.push(item);
    } catch (error) {
      failed.push({ item, error: error as Error });
    }
  }

  return { success, failed };
}
