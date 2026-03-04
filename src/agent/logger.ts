/**
 * Structured logger for Agent Core.
 * Prefixes all messages with context tags for CI/GitHub Actions readability.
 */
export const logger = {
  info(tag: string, message: string): void {
    console.log(`  [${tag}] ${message}`);
  },

  warn(tag: string, message: string): void {
    console.warn(`  [${tag}] ${message}`);
  },

  error(tag: string, message: string): void {
    console.error(`  [${tag}] ${message}`);
  },

  /** Top-level step indicator (no tag prefix) */
  step(message: string): void {
    console.log(message);
  },
};
