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
 * Result of a single agent run.
 */
export interface AgentResult {
  success: boolean;
  error?: string;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  executionTimeMs: number;
  iterationCount: number;
}
