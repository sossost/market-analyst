/**
 * Structured logger for Agent Core.
 * Prefixes all messages with context tags for CI/GitHub Actions readability.
 *
 * Log level is controlled by the LOG_LEVEL environment variable.
 * Supported values: "debug" | "info" | "warn" | "error"
 * Default: "info"
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LOG_LEVELS = new Set<string>(["debug", "info", "warn", "error"]);
const DEFAULT_LOG_LEVEL: LogLevel = "info";

const resolvedLogLevel = ((): LogLevel => {
  const raw = process.env["LOG_LEVEL"];
  if (raw != null && VALID_LOG_LEVELS.has(raw)) {
    return raw as LogLevel;
  }
  return DEFAULT_LOG_LEVEL;
})();
const configuredRank = LOG_LEVEL_RANK[resolvedLogLevel];

function isLevelEnabled(level: LogLevel): boolean {
  const requestedRank = LOG_LEVEL_RANK[level];
  return requestedRank >= configuredRank;
}

export const logger = {
  debug(tag: string, message: string): void {
    if (!isLevelEnabled("debug")) {
      return;
    }
    console.debug(`  [${tag}] ${message}`);
  },

  info(tag: string, message: string): void {
    if (!isLevelEnabled("info")) {
      return;
    }
    console.log(`  [${tag}] ${message}`);
  },

  warn(tag: string, message: string): void {
    if (!isLevelEnabled("warn")) {
      return;
    }
    console.warn(`  [${tag}] ${message}`);
  },

  error(tag: string, message: string): void {
    if (!isLevelEnabled("error")) {
      return;
    }
    console.error(`  [${tag}] ${message}`);
  },

  /** Top-level step indicator (no tag prefix). Always printed regardless of log level. */
  step(message: string): void {
    console.log(message);
  },
};
