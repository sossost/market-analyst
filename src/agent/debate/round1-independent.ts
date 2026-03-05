import Anthropic from "@anthropic-ai/sdk";
import { callAgent, type AgentCallResult } from "./callAgent.js";
import { logger } from "../logger.js";
import type { AgentPersona, RoundOutput, DebateRound } from "../../types/debate.js";
import type { PersonaDefinition } from "../../types/debate.js";

interface Round1Input {
  client: Anthropic;
  experts: PersonaDefinition[];
  question: string;
  memoryContext: string;
}

interface Round1Result {
  round: DebateRound;
  tokensUsed: { input: number; output: number };
}

/**
 * Round 1 — Independent Analysis.
 * 4 experts answer the same question in parallel, unaware of each other's responses.
 */
export async function runRound1(input: Round1Input): Promise<Round1Result> {
  const { client, experts, question, memoryContext } = input;

  let totalInput = 0;
  let totalOutput = 0;
  const outputs: RoundOutput[] = [];
  const errors: Array<{ persona: AgentPersona; error: string }> = [];

  const results = await Promise.allSettled(
    experts.map(async (expert) => {
      const systemPrompt = memoryContext.length > 0
        ? `${expert.systemPrompt}\n\n## 장기 기억 (검증된 원칙)\n${memoryContext}`
        : expert.systemPrompt;

      const result = await callAgent(client, systemPrompt, question);
      return { persona: expert.name as AgentPersona, result };
    }),
  );

  for (const settled of results) {
    if (settled.status === "fulfilled") {
      const { persona, result } = settled.value;
      outputs.push({ persona, content: result.content });
      totalInput += result.tokensUsed.input;
      totalOutput += result.tokensUsed.output;
      logger.info("Round1", `${persona} completed (${result.tokensUsed.output} output tokens)`);
    } else {
      const errorMsg = settled.reason instanceof Error
        ? settled.reason.message
        : String(settled.reason);
      logger.error("Round1", `Agent failed: ${errorMsg}`);
    }
  }

  if (outputs.length === 0) {
    throw new Error("Round 1 failed: no agents produced output");
  }

  return {
    round: { round: 1, outputs },
    tokensUsed: { input: totalInput, output: totalOutput },
  };
}
