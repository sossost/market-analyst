/**
 * @deprecated Import from "@/lib/retry" instead.
 * This re-export exists for backward compatibility.
 */
export {
  withRetry,
  retryDatabaseOperation,
  retryApiCall,
  DEFAULT_RETRY_OPTIONS,
} from "@/lib/retry";
export type { RetryOptions, RetryResult } from "@/lib/retry";
