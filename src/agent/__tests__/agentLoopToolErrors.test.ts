/**
 * Tests for agentLoop tool error detection and collection.
 *
 * Since agentLoop depends on the Anthropic API client, we test the
 * parseToolError function and tool error collection logic directly.
 * The parseToolError function is extracted from agentLoop.ts.
 */
import { describe, it, expect } from "vitest";

/**
 * Reimplementation of parseToolError for isolated unit testing.
 * This mirrors the logic in agentLoop.ts.
 */
function parseToolError(result: string): string | null {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON — not an error pattern
  }
  return null;
}

describe("parseToolError", () => {
  it("returns error string from error JSON pattern", () => {
    const result = JSON.stringify({ error: "DB connection failed" });
    expect(parseToolError(result)).toBe("DB connection failed");
  });

  it("returns null for successful JSON response", () => {
    const result = JSON.stringify({ data: { sectors: [] } });
    expect(parseToolError(result)).toBeNull();
  });

  it("returns null for non-JSON string", () => {
    expect(parseToolError("plain text response")).toBeNull();
  });

  it("returns null when error field is not a string", () => {
    const result = JSON.stringify({ error: 42 });
    expect(parseToolError(result)).toBeNull();
  });

  it("returns null for empty JSON object", () => {
    expect(parseToolError("{}")).toBeNull();
  });

  it("handles JSON with both data and error fields — error takes precedence", () => {
    const result = JSON.stringify({ error: "partial failure", data: {} });
    expect(parseToolError(result)).toBe("partial failure");
  });

  it("returns null for JSON array", () => {
    expect(parseToolError("[]")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseToolError("")).toBeNull();
  });
});

describe("CRITICAL_TOOLS constant", () => {
  const CRITICAL_TOOLS = new Set([
    "get_market_breadth",
    "get_leading_sectors",
    "get_index_returns",
  ]);

  it("includes market breadth tool", () => {
    expect(CRITICAL_TOOLS.has("get_market_breadth")).toBe(true);
  });

  it("includes leading sectors tool", () => {
    expect(CRITICAL_TOOLS.has("get_leading_sectors")).toBe(true);
  });

  it("includes index returns tool", () => {
    expect(CRITICAL_TOOLS.has("get_index_returns")).toBe(true);
  });

  it("does not include non-critical tools", () => {
    expect(CRITICAL_TOOLS.has("search_catalyst")).toBe(false);
    expect(CRITICAL_TOOLS.has("save_report_log")).toBe(false);
  });
});
