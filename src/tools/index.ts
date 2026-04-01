import type { AgentTool } from "./types";
import { reportToolError } from "./toolErrorReporter";
import { logger } from "@/lib/logger";

/**
 * Execute a tool by name from the registry.
 * Returns the tool result as a string (JSON for structured data).
 */
export async function executeTool(
  tools: AgentTool[],
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((t) => t.definition.name === name);
  if (tool == null) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  try {
    return await tool.execute(input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown tool error";

    logger.error("Tool", `${name} failed: ${message}`);

    // Fire-and-forget: report to Discord + GitHub without blocking
    reportToolError(name, message, input).catch(() => {
      /* swallow — reportToolError already handles its own errors */
    });

    return JSON.stringify({ error: message });
  }
}
