import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/discord", () => ({
  sendDiscordError: vi.fn().mockResolvedValue(undefined),
  sanitizeErrorForDiscord: vi.fn((msg: string) => msg.slice(0, 500)),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  reportToolError,
  resetToolErrorDedup,
  _testing,
} from "../toolErrorReporter";
import { sendDiscordError } from "@/lib/discord";
import { logger } from "@/lib/logger";

const { buildDedupKey, buildIssueTitle, buildIssueBody, getGitHubConfig } = _testing;

describe("toolErrorReporter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetToolErrorDedup();
    // Re-mock after restore
    vi.mocked(sendDiscordError).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_REPOSITORY"];
  });

  // ────────────────────────────────────────────
  // buildDedupKey
  // ────────────────────────────────────────────

  describe("buildDedupKey", () => {
    it("combines toolName and errorMessage with separator", () => {
      const key = buildDedupKey("get_market_breadth", "connection timeout");
      expect(key).toBe("get_market_breadth::connection timeout");
    });
  });

  // ────────────────────────────────────────────
  // buildIssueTitle
  // ────────────────────────────────────────────

  describe("buildIssueTitle", () => {
    it("formats title with tool name and error", () => {
      const title = buildIssueTitle("get_market_breadth", "type mismatch");
      expect(title).toBe("[Tool Error] get_market_breadth: type mismatch");
    });

    it("truncates long error messages to fit title limit", () => {
      const longError = "a".repeat(200);
      const title = buildIssueTitle("tool", longError);
      expect(title.length).toBeLessThanOrEqual(100);
      expect(title).toContain("...");
    });
  });

  // ────────────────────────────────────────────
  // buildIssueBody
  // ────────────────────────────────────────────

  describe("buildIssueBody", () => {
    it("includes tool name, error, and input in body", () => {
      const body = buildIssueBody("get_index_returns", "query failed", { date: "2026-04-01" });
      expect(body).toContain("get_index_returns");
      expect(body).toContain("query failed");
      expect(body).toContain("2026-04-01");
      expect(body).toContain("자동 생성 안내");
    });
  });

  // ────────────────────────────────────────────
  // getGitHubConfig
  // ────────────────────────────────────────────

  describe("getGitHubConfig", () => {
    it("returns null when GITHUB_TOKEN is not set", () => {
      delete process.env["GITHUB_TOKEN"];
      expect(getGitHubConfig()).toBeNull();
    });

    it("returns config with default repo when GITHUB_TOKEN is set", () => {
      process.env["GITHUB_TOKEN"] = "ghp_test123";
      const config = getGitHubConfig();
      expect(config).toEqual({
        token: "ghp_test123",
        owner: "sossost",
        repo: "market-analyst",
      });
    });

    it("uses GITHUB_REPOSITORY env var when set", () => {
      process.env["GITHUB_TOKEN"] = "ghp_test123";
      process.env["GITHUB_REPOSITORY"] = "myorg/myrepo";
      const config = getGitHubConfig();
      expect(config).toEqual({
        token: "ghp_test123",
        owner: "myorg",
        repo: "myrepo",
      });
    });
  });

  // ────────────────────────────────────────────
  // reportToolError
  // ────────────────────────────────────────────

  describe("reportToolError", () => {
    it("sends Discord notification on first error", async () => {
      await reportToolError("get_market_breadth", "connection timeout", { date: "2026-04-01" });

      expect(sendDiscordError).toHaveBeenCalledOnce();
      expect(vi.mocked(sendDiscordError).mock.calls[0]?.[0]).toContain("get_market_breadth");
      expect(vi.mocked(sendDiscordError).mock.calls[0]?.[0]).toContain("connection timeout");
    });

    it("deduplicates same toolName + error within session", async () => {
      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-01" });
      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-01" });
      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-02" });

      // Only first call should trigger notification
      expect(sendDiscordError).toHaveBeenCalledOnce();
    });

    it("reports different errors separately", async () => {
      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-01" });
      await reportToolError("get_market_breadth", "type mismatch", { date: "2026-04-01" });

      expect(sendDiscordError).toHaveBeenCalledTimes(2);
    });

    it("reports different tools separately", async () => {
      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-01" });
      await reportToolError("get_index_returns", "timeout", { date: "2026-04-01" });

      expect(sendDiscordError).toHaveBeenCalledTimes(2);
    });

    it("does not throw when Discord fails", async () => {
      vi.mocked(sendDiscordError).mockRejectedValueOnce(new Error("webhook down"));

      // Should not throw
      await expect(
        reportToolError("get_market_breadth", "error", { date: "2026-04-01" }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        "ToolErrorReporter",
        expect.stringContaining("Discord notification failed"),
      );
    });

    it("skips GitHub issue creation when GITHUB_TOKEN is not set", async () => {
      delete process.env["GITHUB_TOKEN"];

      await reportToolError("get_market_breadth", "error", { date: "2026-04-01" });

      expect(logger.warn).toHaveBeenCalledWith(
        "ToolErrorReporter",
        expect.stringContaining("GITHUB_TOKEN not set"),
      );
    });

    it("resets dedup set with resetToolErrorDedup", async () => {
      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-01" });
      expect(sendDiscordError).toHaveBeenCalledOnce();

      resetToolErrorDedup();

      await reportToolError("get_market_breadth", "timeout", { date: "2026-04-01" });
      expect(sendDiscordError).toHaveBeenCalledTimes(2);
    });
  });
});
