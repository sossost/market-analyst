import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import {
  isEnvironmentError,
  extractPrUrl,
  getLockFilePath,
  isRepairLocked,
  acquireLock,
  releaseLock,
  isClaudeCliAvailable,
  triggerRepair,
  type RepairRequest,
} from "../etl-repair.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock fs selectively — keep real implementation for most operations
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      statSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock logger to suppress output
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

const { execSync } = await import("node:child_process");
const mockedExecSync = vi.mocked(execSync);
const mockedFs = vi.mocked(fs);

describe("isEnvironmentError", () => {
  it("detects ECONNREFUSED as environment error", () => {
    expect(isEnvironmentError("connect ECONNREFUSED 127.0.0.1:5432")).toBe(true);
  });

  it("detects ETIMEDOUT as environment error", () => {
    expect(isEnvironmentError("connection ETIMEDOUT")).toBe(true);
  });

  it("detects rate limit as environment error", () => {
    expect(isEnvironmentError("API rate limit exceeded")).toBe(true);
  });

  it("detects 401 unauthorized as environment error", () => {
    expect(isEnvironmentError("Request failed with status 401")).toBe(true);
  });

  it("detects 403 forbidden as environment error", () => {
    expect(isEnvironmentError("HTTP 403 Forbidden")).toBe(true);
  });

  it("detects authentication errors", () => {
    expect(isEnvironmentError("authentication failed for user")).toBe(true);
  });

  it("detects SSL errors", () => {
    expect(isEnvironmentError("SSL certificate problem")).toBe(true);
  });

  it("returns false for code errors", () => {
    expect(isEnvironmentError("Cannot read properties of undefined")).toBe(false);
  });

  it("returns false for SQL errors", () => {
    expect(isEnvironmentError('column "foo" does not exist')).toBe(false);
  });

  it("returns false for type errors", () => {
    expect(isEnvironmentError("TypeError: x is not a function")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isEnvironmentError("SSL_ERROR_HANDSHAKE")).toBe(true);
  });
});

describe("extractPrUrl", () => {
  it("extracts PR URL from output", () => {
    const output = "Some text\nhttps://github.com/user/repo/pull/123\nMore text";
    expect(extractPrUrl(output)).toBe("https://github.com/user/repo/pull/123");
  });

  it("returns null when no PR URL found", () => {
    expect(extractPrUrl("No URL here")).toBeNull();
  });

  it("extracts first PR URL when multiple present", () => {
    const output =
      "https://github.com/user/repo/pull/1\nhttps://github.com/user/repo/pull/2";
    expect(extractPrUrl(output)).toBe("https://github.com/user/repo/pull/1");
  });

  it("handles PR URL with org name", () => {
    const output = "PR: https://github.com/sossost/market-analyst/pull/456";
    expect(extractPrUrl(output)).toBe(
      "https://github.com/sossost/market-analyst/pull/456",
    );
  });
});

describe("getLockFilePath", () => {
  it("returns path with sanitized job name", () => {
    expect(getLockFilePath("build-daily-ma")).toBe(
      "/tmp/etl-repair-build-daily-ma.lock",
    );
  });

  it("sanitizes special characters", () => {
    expect(getLockFilePath("job/with spaces")).toBe(
      "/tmp/etl-repair-job_with_spaces.lock",
    );
  });
});

describe("isRepairLocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when lock file does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(isRepairLocked("test-job")).toBe(false);
  });

  it("returns true when lock file exists and is fresh", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);
    expect(isRepairLocked("test-job")).toBe(true);
  });

  it("returns false and removes stale lock (>10 min old)", () => {
    mockedFs.existsSync.mockReturnValue(true);
    const ELEVEN_MINUTES_AGO = Date.now() - 11 * 60 * 1_000;
    mockedFs.statSync.mockReturnValue({
      mtimeMs: ELEVEN_MINUTES_AGO,
    } as fs.Stats);
    mockedFs.unlinkSync.mockImplementation(() => {});

    expect(isRepairLocked("test-job")).toBe(false);
    expect(mockedFs.unlinkSync).toHaveBeenCalled();
  });
});

describe("acquireLock / releaseLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires lock when not locked", () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => {});

    expect(acquireLock("test-job")).toBe(true);
    expect(mockedFs.writeFileSync).toHaveBeenCalled();
  });

  it("fails to acquire when already locked", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);

    expect(acquireLock("test-job")).toBe(false);
  });

  it("releases lock by deleting file", () => {
    mockedFs.unlinkSync.mockImplementation(() => {});
    releaseLock("test-job");
    expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
      "/tmp/etl-repair-test-job.lock",
    );
  });
});

describe("isClaudeCliAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when claude CLI is found", () => {
    mockedExecSync.mockReturnValue(Buffer.from("/usr/local/bin/claude"));
    expect(isClaudeCliAvailable()).toBe(true);
  });

  it("returns false when claude CLI is not found", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(isClaudeCliAvailable()).toBe(false);
  });
});

describe("triggerRepair", () => {
  const baseRequest: RepairRequest = {
    jobName: "build-daily-ma",
    errorLog: 'column "foo" does not exist',
    relatedFiles: ["src/etl/jobs/build-daily-ma.ts"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips environment errors", async () => {
    const result = await triggerRepair({
      ...baseRequest,
      errorLog: "connect ECONNREFUSED 127.0.0.1:5432",
    });

    expect(result.attempted).toBe(false);
    expect(result.reason).toBe("environment_error");
  });

  it("skips when already locked", async () => {
    // Simulate existing lock
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);

    const result = await triggerRepair(baseRequest);

    expect(result.attempted).toBe(false);
    expect(result.reason).toBe("already_locked");
  });

  it("skips when CLI not available", async () => {
    // No lock
    mockedFs.existsSync.mockImplementation((p) => {
      if (String(p).includes(".lock")) return false;
      return false;
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.unlinkSync.mockImplementation(() => {});

    // CLI not found
    mockedExecSync.mockImplementation((cmd) => {
      if (String(cmd) === "which claude") {
        throw new Error("not found");
      }
      return Buffer.from("");
    });

    const result = await triggerRepair(baseRequest);

    expect(result.attempted).toBe(false);
    expect(result.reason).toBe("cli_not_available");
  });

  it("skips when repair script not found", async () => {
    // No lock
    mockedFs.existsSync.mockImplementation((p) => {
      if (String(p).includes(".lock")) return false;
      if (String(p).includes("auto-repair.sh")) return false;
      return false;
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.unlinkSync.mockImplementation(() => {});

    // CLI found
    mockedExecSync.mockImplementation((cmd) => {
      if (String(cmd) === "which claude") {
        return Buffer.from("/usr/local/bin/claude");
      }
      return Buffer.from("");
    });

    const result = await triggerRepair(baseRequest);

    expect(result.attempted).toBe(false);
    expect(result.reason).toBe("script_not_found");
  });

  it("returns success with PR URL when repair succeeds", async () => {
    // No lock, script exists
    mockedFs.existsSync.mockImplementation((p) => {
      if (String(p).includes(".lock")) return false;
      return true; // Script exists
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.unlinkSync.mockImplementation(() => {});

    // CLI found, repair succeeds with PR URL
    // execSync with encoding: "utf-8" returns string, not Buffer
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which claude") {
        return Buffer.from("/usr/local/bin/claude");
      }
      if (cmdStr.includes("auto-repair.sh")) {
        return "Repair done\nhttps://github.com/sossost/market-analyst/pull/999\n" as never;
      }
      return Buffer.from("");
    });

    const result = await triggerRepair(baseRequest);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.reason).toBe("pr_created");
    expect(result.prUrl).toBe(
      "https://github.com/sossost/market-analyst/pull/999",
    );
  });

  it("returns failure when repair produces no PR", async () => {
    mockedFs.existsSync.mockImplementation((p) => {
      if (String(p).includes(".lock")) return false;
      return true;
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.unlinkSync.mockImplementation(() => {});

    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which claude") {
        return Buffer.from("/usr/local/bin/claude");
      }
      if (cmdStr.includes("auto-repair.sh")) {
        return "No changes made by Claude Code" as never;
      }
      return Buffer.from("");
    });

    const result = await triggerRepair(baseRequest);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("no_pr_created");
  });

  it("returns failure when repair script throws", async () => {
    mockedFs.existsSync.mockImplementation((p) => {
      if (String(p).includes(".lock")) return false;
      return true;
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.unlinkSync.mockImplementation(() => {});

    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which claude") {
        return Buffer.from("/usr/local/bin/claude");
      }
      if (cmdStr.includes("auto-repair.sh")) {
        throw new Error("Script crashed");
      }
      return Buffer.from("");
    });

    const result = await triggerRepair(baseRequest);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("repair_failed");
  });

  it("always releases lock even on failure", async () => {
    mockedFs.existsSync.mockImplementation((p) => {
      if (String(p).includes(".lock")) return false;
      return true;
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.unlinkSync.mockImplementation(() => {});

    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which claude") {
        return Buffer.from("/usr/local/bin/claude");
      }
      throw new Error("fail");
    });

    await triggerRepair(baseRequest);

    // Lock should be released (unlinkSync called for lock file)
    expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("etl-repair-build-daily-ma.lock"),
    );
  });
});
