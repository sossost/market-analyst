import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../toolErrorReporter", () => ({
  reportToolError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { executeTool } from "../index";
import { reportToolError } from "../toolErrorReporter";
import type { AgentTool } from "../types";

function createMockTool(
  name: string,
  executeFn: (input: Record<string, unknown>) => Promise<string>,
): AgentTool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    execute: executeFn,
  };
}

describe("executeTool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(reportToolError).mockResolvedValue(undefined);
  });

  it("returns tool result on success", async () => {
    const tools = [
      createMockTool("test_tool", async () => JSON.stringify({ data: "ok" })),
    ];

    const result = await executeTool(tools, "test_tool", { date: "2026-04-01" });
    expect(JSON.parse(result)).toEqual({ data: "ok" });
    expect(reportToolError).not.toHaveBeenCalled();
  });

  it("returns error JSON for unknown tool", async () => {
    const result = await executeTool([], "unknown_tool", {});
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("Unknown tool: unknown_tool");
    // Unknown tool is not reported via reportToolError (only catch block errors)
    expect(reportToolError).not.toHaveBeenCalled();
  });

  it("catches tool errors and calls reportToolError", async () => {
    const tools = [
      createMockTool("failing_tool", async () => {
        throw new Error("DB connection failed");
      }),
    ];

    const result = await executeTool(tools, "failing_tool", { date: "2026-04-01" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("DB connection failed");

    expect(reportToolError).toHaveBeenCalledOnce();
    expect(reportToolError).toHaveBeenCalledWith(
      "failing_tool",
      "DB connection failed",
      { date: "2026-04-01" },
    );
  });

  it("handles non-Error thrown values", async () => {
    const tools = [
      createMockTool("string_throw", async () => {
        throw "raw string error";
      }),
    ];

    const result = await executeTool(tools, "string_throw", {});
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("Unknown tool error");

    expect(reportToolError).toHaveBeenCalledWith(
      "string_throw",
      "Unknown tool error",
      {},
    );
  });

  it("does not block on reportToolError failure", async () => {
    vi.mocked(reportToolError).mockRejectedValueOnce(new Error("reporter crash"));

    const tools = [
      createMockTool("failing_tool", async () => {
        throw new Error("tool error");
      }),
    ];

    // Should not throw even if reporter fails
    const result = await executeTool(tools, "failing_tool", {});
    expect(JSON.parse(result).error).toBe("tool error");
  });
});
