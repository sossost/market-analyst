import Anthropic from "@anthropic-ai/sdk";
import { loadExpertPersonas, loadModeratorPersona } from "./personas.js";
import { runRound1 } from "./round1-independent.js";
import { runRound2 } from "./round2-crossfire.js";
import { runRound3 } from "./round3-synthesis.js";
import { logger } from "../logger.js";
import type { AgentPersona, DebateResult } from "../../types/debate.js";

interface DebateConfig {
  question: string;
  debateDate: string;
  memoryContext?: string;
  marketDataContext?: string;
}

/**
 * Run a full 3-round debate.
 *
 * Round 1: Independent analysis (4 experts in parallel)
 * Round 2: Crossfire (4 experts read others' analysis, parallel)
 * Round 3: Moderator synthesis (single call)
 *
 * Individual agent failures are tolerated — debate continues with remaining agents.
 */
export async function runDebate(config: DebateConfig): Promise<DebateResult> {
  const { question, debateDate, memoryContext = "", marketDataContext = "" } = config;
  const startTime = Date.now();

  const client = new Anthropic();
  const experts = loadExpertPersonas();
  const moderator = loadModeratorPersona();
  const agentErrors: DebateResult["metadata"]["agentErrors"] = [];

  // Combine question with market data context
  const fullQuestion = marketDataContext.length > 0
    ? `${question}\n\n---\n\n${marketDataContext}`
    : question;

  logger.info("Debate", `Starting debate for ${debateDate}`);
  logger.info("Debate", `Question: ${question.slice(0, 100)}...`);
  if (marketDataContext.length > 0) {
    logger.info("Debate", `Market data context: ${marketDataContext.length} chars`);
  }

  // Round 1 — Independent Analysis
  logger.info("Debate", "=== Round 1: Independent Analysis ===");
  const round1Result = await runRound1({
    client,
    experts,
    question: fullQuestion,
    memoryContext,
  });

  const failedInRound1 = experts
    .map((e) => e.name as AgentPersona)
    .filter((name) => !round1Result.round.outputs.some((o) => o.persona === name));
  for (const persona of failedInRound1) {
    agentErrors.push({ persona, round: 1, error: "Failed to produce output" });
  }

  // Round 2 — Crossfire
  logger.info("Debate", "=== Round 2: Crossfire ===");
  const round2Result = await runRound2({
    client,
    experts,
    round1Outputs: round1Result.round.outputs,
    question: fullQuestion,
  });

  const activeInRound1 = round1Result.round.outputs.map((o) => o.persona);
  const failedInRound2 = activeInRound1.filter(
    (name) => !round2Result.round.outputs.some((o) => o.persona === name),
  );
  for (const persona of failedInRound2) {
    agentErrors.push({ persona, round: 2, error: "Failed to produce output" });
  }

  // Round 3 — Moderator Synthesis
  logger.info("Debate", "=== Round 3: Moderator Synthesis ===");
  const round3Result = await runRound3({
    client,
    moderator,
    round1Outputs: round1Result.round.outputs,
    round2Outputs: round2Result.round.outputs,
    question: fullQuestion,
  });

  const totalDurationMs = Date.now() - startTime;
  const totalTokens = {
    input:
      round1Result.tokensUsed.input +
      round2Result.tokensUsed.input +
      round3Result.tokensUsed.input,
    output:
      round1Result.tokensUsed.output +
      round2Result.tokensUsed.output +
      round3Result.tokensUsed.output,
  };

  logger.info("Debate", `Debate complete in ${(totalDurationMs / 1000).toFixed(1)}s`);
  logger.info("Debate", `Tokens: ${totalTokens.input} in / ${totalTokens.output} out`);
  logger.info("Debate", `Theses extracted: ${round3Result.synthesis.theses.length}`);

  return {
    debateDate,
    round1: round1Result.round,
    round2: round2Result.round,
    round3: round3Result.synthesis,
    metadata: {
      totalTokens,
      totalDurationMs,
      agentErrors,
    },
  };
}
