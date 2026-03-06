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

  // Rate limit 회피: 2명씩 배치, 배치 간 딜레이
  const BATCH_SIZE = 2;
  const BATCH_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 10_000;
  for (let i = 0; i < experts.length; i += BATCH_SIZE) {
    if (i > 0 && BATCH_DELAY_MS > 0) {
      logger.info("Round1", `Batch delay ${BATCH_DELAY_MS / 1000}s (rate limit mitigation)`);
      await new Promise<void>((r) => setTimeout(r, BATCH_DELAY_MS));
    }
    const batch = experts.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (expert) => {
        const systemPrompt = memoryContext.length > 0
          ? `${expert.systemPrompt}\n\n## 장기 기억 (검증된 원칙)\n${memoryContext}`
          : expert.systemPrompt;

        const result = await callAgent(client, systemPrompt, question);
        return { persona: expert.name as AgentPersona, result };
      }),
    );

    for (let index = 0; index < results.length; index++) {
      const settled = results[index];
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
        logger.error("Round1", `${batch[index].name} failed: ${errorMsg}`);
      }
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
