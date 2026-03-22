import { describe, it, expect, vi } from "vitest";
import { executeTool } from "@/tools/index";
import type { AgentTool } from "@/tools/types";

function createMockTool(
  name: string,
  result: string,
): AgentTool {
  return {
    definition: {
      name,
      description: `Mock ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    execute: vi.fn().mockResolvedValue(result),
  };
}

describe("executeTool", () => {
  it("executes the matching tool and returns result", async () => {
    const tool = createMockTool("test_tool", '{"data":"ok"}');
    const result = await executeTool([tool], "test_tool", { key: "value" });

    expect(result).toBe('{"data":"ok"}');
    expect(tool.execute).toHaveBeenCalledWith({ key: "value" });
  });

  it("returns error JSON for unknown tool", async () => {
    const result = await executeTool([], "nonexistent", {});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe("Unknown tool: nonexistent");
  });

  it("catches tool execution errors and returns error JSON", async () => {
    const tool: AgentTool = {
      definition: {
        name: "failing_tool",
        description: "Fails",
        input_schema: { type: "object" as const, properties: {} },
      },
      execute: vi.fn().mockRejectedValue(new Error("DB connection failed")),
    };

    const result = await executeTool([tool], "failing_tool", {});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe("DB connection failed");
  });

  it("selects the correct tool from multiple tools", async () => {
    const tool1 = createMockTool("tool_a", "result_a");
    const tool2 = createMockTool("tool_b", "result_b");

    const result = await executeTool([tool1, tool2], "tool_b", {});

    expect(result).toBe("result_b");
    expect(tool1.execute).not.toHaveBeenCalled();
    expect(tool2.execute).toHaveBeenCalled();
  });
});
