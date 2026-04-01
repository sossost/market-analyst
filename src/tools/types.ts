import type Anthropic from "@anthropic-ai/sdk";

/**
 * Agent tool definition — each tool has a Claude API schema + an execute function.
 */
export interface AgentTool {
  definition: Anthropic.Tool;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * Agent configuration for a single run.
 */
export interface AgentConfig {
  targetDate: string;
  systemPrompt: string;
  tools: AgentTool[];
  model: string;
  maxTokens: number;
  maxIterations: number;
}

/**
 * A tool error captured during agent execution.
 */
export interface ToolError {
  toolName: string;
  error: string;
  input: Record<string, unknown>;
  timestamp: string;
}

/**
 * Result of a single agent run.
 */
export interface AgentResult {
  success: boolean;
  error?: string;
  tokensUsed: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  toolCalls: number;
  executionTimeMs: number;
  iterationCount: number;
  toolErrors?: ToolError[];
}
