import { execSync, type ExecSyncOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";

const TAG = "ETL_REPAIR";

const LOCK_DIR = "/tmp";
const REPAIR_SCRIPT_PATH = path.resolve(
  process.cwd(),
  "scripts/auto-repair.sh",
);

/**
 * Error patterns that indicate environment/infrastructure issues
 * rather than code bugs. These are NOT candidates for auto-repair.
 */
const ENVIRONMENT_ERROR_PATTERNS = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "rate limit",
  "quota exceeded",
  "401",
  "403",
  "authentication",
  "unauthorized",
  "forbidden",
  "certificate",
  "SSL",
  "DNS",
] as const;

export interface RepairRequest {
  jobName: string;
  errorLog: string;
  relatedFiles: string[];
}

export interface RepairResult {
  attempted: boolean;
  success: boolean;
  reason: string;
  prUrl?: string;
}

/**
 * Check if the error message indicates an environment/infrastructure issue
 * that cannot be fixed by code changes.
 */
export function isEnvironmentError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase();
  return ENVIRONMENT_ERROR_PATTERNS.some((pattern) =>
    lowerMessage.includes(pattern.toLowerCase()),
  );
}

/**
 * Get the lock file path for a given job name.
 */
export function getLockFilePath(jobName: string): string {
  const sanitized = jobName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return path.join(LOCK_DIR, `etl-repair-${sanitized}.lock`);
}

/**
 * Check if a repair is already in progress for the given job.
 */
export function isRepairLocked(jobName: string): boolean {
  const lockFile = getLockFilePath(jobName);
  if (!fs.existsSync(lockFile)) {
    return false;
  }

  // Lock expires after 10 minutes to prevent stale locks
  const LOCK_EXPIRY_MS = 10 * 60 * 1_000;
  try {
    const stat = fs.statSync(lockFile);
    const age = Date.now() - stat.mtimeMs;
    if (age > LOCK_EXPIRY_MS) {
      logger.warn(TAG, `Stale lock found for ${jobName}, removing`);
      fs.unlinkSync(lockFile);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a lock for repair of the given job.
 */
export function acquireLock(jobName: string): boolean {
  if (isRepairLocked(jobName)) {
    return false;
  }

  const lockFile = getLockFilePath(jobName);
  try {
    fs.writeFileSync(lockFile, `${Date.now()}\n${process.pid}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the lock for the given job.
 */
export function releaseLock(jobName: string): void {
  const lockFile = getLockFilePath(jobName);
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Lock file may already be removed
  }
}

/**
 * Check if Claude Code CLI is available on the system.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    execSync("which claude", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger auto-repair for a failed ETL job.
 *
 * This function:
 * 1. Validates the error is a code issue (not environment)
 * 2. Checks for existing repair lock (prevents duplicate attempts)
 * 3. Verifies Claude Code CLI is available
 * 4. Calls the auto-repair.sh script
 * 5. Returns the result with PR URL if successful
 */
export async function triggerRepair(
  request: RepairRequest,
): Promise<RepairResult> {
  const { jobName, errorLog, relatedFiles } = request;

  // 1. Skip environment errors
  if (isEnvironmentError(errorLog)) {
    logger.info(TAG, `Skipping repair for ${jobName}: environment error detected`);
    return {
      attempted: false,
      success: false,
      reason: "environment_error",
    };
  }

  // 2. Check lock
  if (!acquireLock(jobName)) {
    logger.warn(TAG, `Repair already in progress for ${jobName}`);
    return {
      attempted: false,
      success: false,
      reason: "already_locked",
    };
  }

  try {
    // 3. Check CLI availability
    if (!isClaudeCliAvailable()) {
      logger.error(TAG, "Claude Code CLI not found — skipping auto-repair");
      return {
        attempted: false,
        success: false,
        reason: "cli_not_available",
      };
    }

    // 4. Check repair script exists
    if (!fs.existsSync(REPAIR_SCRIPT_PATH)) {
      logger.error(TAG, `Repair script not found: ${REPAIR_SCRIPT_PATH}`);
      return {
        attempted: false,
        success: false,
        reason: "script_not_found",
      };
    }

    // 5. Execute repair script
    logger.info(TAG, `Starting auto-repair for ${jobName}`);

    const execOptions: ExecSyncOptions = {
      cwd: process.cwd(),
      timeout: 5 * 60 * 1_000, // 5 minute timeout
      env: {
        ...process.env,
        REPAIR_JOB_NAME: jobName,
        REPAIR_ERROR_LOG: errorLog,
        REPAIR_RELATED_FILES: relatedFiles.join(","),
      },
      stdio: "pipe",
      encoding: "utf-8",
    };

    const output = execSync(
      `bash "${REPAIR_SCRIPT_PATH}"`,
      execOptions,
    ) as unknown as string;

    // 6. Parse PR URL from output
    const prUrl = extractPrUrl(output);

    if (prUrl != null) {
      logger.info(TAG, `Auto-repair PR created: ${prUrl}`);
      return {
        attempted: true,
        success: true,
        reason: "pr_created",
        prUrl,
      };
    }

    logger.warn(TAG, `Auto-repair completed but no PR URL found`);
    return {
      attempted: true,
      success: false,
      reason: "no_pr_created",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(TAG, `Auto-repair failed for ${jobName}: ${message}`);
    return {
      attempted: true,
      success: false,
      reason: "repair_failed",
    };
  } finally {
    releaseLock(jobName);
  }
}

/**
 * Extract a GitHub PR URL from command output.
 */
export function extractPrUrl(output: string): string | null {
  const match = output.match(
    /https:\/\/github\.com\/[^\s]+\/pull\/\d+/,
  );
  return match != null ? match[0] : null;
}
