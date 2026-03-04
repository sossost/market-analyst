import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "@/agent/tools/types";
import type { AgentTool } from "@/agent/tools/types";

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// Import after mock setup
const { runAgentLoop } = await import("@/agent/agentLoop");

function createMockTool(name: string): AgentTool {
  return {
    definition: {
      name,
      description: `Mock ${name}`,
      input_schema: { type: "object" as const, properties: {} },
    },
    execute: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
  };
}

function makeConfig(tools: AgentTool[]): AgentConfig {
  return {
    targetDate: "2026-03-04",
    systemPrompt: "You are a test agent.",
    tools,
    model: "claude-opus-4-6",
    maxTokens: 1024,
    maxIterations: 10,
  };
}

describe("runAgentLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes when Claude returns end_turn immediately", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Analysis complete." }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await runAgentLoop(makeConfig([]));

    expect(result.success).toBe(true);
    expect(result.iterationCount).toBe(1);
    expect(result.tokensUsed.input).toBe(100);
    expect(result.tokensUsed.output).toBe(50);
    expect(result.toolCalls).toBe(0);
  });

  it("executes tool calls and continues the loop", async () => {
    const mockTool = createMockTool("get_market_breadth");

    // First call: Claude requests a tool
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "get_market_breadth",
          input: { date: "2026-03-04" },
        },
      ],
      usage: { input_tokens: 200, output_tokens: 30 },
    });

    // Second call: Claude finishes
    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await runAgentLoop(makeConfig([mockTool]));

    expect(result.success).toBe(true);
    expect(result.iterationCount).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(result.tokensUsed.input).toBe(500);
    expect(result.tokensUsed.output).toBe(130);
    expect(mockTool.execute).toHaveBeenCalledWith({ date: "2026-03-04" });
  });

  it("handles multiple tool calls in a single response", async () => {
    const tool1 = createMockTool("tool_a");
    const tool2 = createMockTool("tool_b");

    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "tool_a", input: {} },
        { type: "tool_use", id: "t2", name: "tool_b", input: {} },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const result = await runAgentLoop(makeConfig([tool1, tool2]));

    expect(result.success).toBe(true);
    expect(result.toolCalls).toBe(2);
    expect(tool1.execute).toHaveBeenCalledOnce();
    expect(tool2.execute).toHaveBeenCalledOnce();
  });

  it("fails when max iterations reached", async () => {
    // Always request tool calls, never end_turn
    mockCreate.mockResolvedValue({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "test", input: {} },
      ],
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const tool = createMockTool("test");
    const config = makeConfig([tool]);
    config.maxIterations = 3;

    const result = await runAgentLoop(config);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Max iterations");
    expect(result.iterationCount).toBe(3);
  });

  it("accumulates token usage across iterations", async () => {
    const tool = createMockTool("test_tool");

    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: `t${i}`, name: "test_tool", input: {} },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    }

    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await runAgentLoop(makeConfig([tool]));

    expect(result.tokensUsed.input).toBe(400);
    expect(result.tokensUsed.output).toBe(200);
    expect(result.toolCalls).toBe(3);
    expect(result.iterationCount).toBe(4);
  });
});
