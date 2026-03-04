import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { runAgentLoop } from "./agentLoop";
import { buildSystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "./discord";
import { logger } from "./logger";
import type { AgentConfig } from "./tools/types";

// Tools
import { getMarketBreadth } from "./tools/getMarketBreadth";
import { getLeadingSectors } from "./tools/getLeadingSectors";
import { getPhase2Stocks } from "./tools/getPhase2Stocks";
import { getStockDetail } from "./tools/getStockDetail";
import { readReportHistory } from "./tools/readReportHistory";
import { sendDiscordReport } from "./tools/sendDiscordReport";
import { saveReportLogTool } from "./tools/saveReportLog";

const MODEL = "claude-opus-4-6";
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 15;

// Opus 4.6 pricing (USD per 1M tokens, as of 2026-03)
const OPUS_INPUT_COST_PER_M = 5;
const OPUS_OUTPUT_COST_PER_M = 25;

// Optional env vars (not validated here):
// - DISCORD_ERROR_WEBHOOK_URL: routes errors to a separate channel.
//   Falls back to DISCORD_WEBHOOK_URL if unset.
function validateAgentEnvironment(): void {
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY", "DISCORD_WEBHOOK_URL"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

async function main() {
  logger.step("=== Agent Core: Daily Market Analysis ===\n");

  // 1. 환경변수 검증
  validateAgentEnvironment();
  logger.step("[1/4] Environment validated");

  // 2. 최신 거래일 확인
  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.step("No trade date found. Skipping.");
    await sendDiscordMessage("📊 오늘은 거래일이 아닙니다. Agent 실행을 스킵합니다.");
    await pool.end();
    return;
  }
  logger.step(`[2/4] Target date: ${targetDate}`);

  // 3. Agent 실행
  logger.step("[3/4] Running agent loop...\n");

  const config: AgentConfig = {
    targetDate,
    systemPrompt: buildSystemPrompt(),
    tools: [
      getMarketBreadth,
      getLeadingSectors,
      getPhase2Stocks,
      getStockDetail,
      readReportHistory,
      sendDiscordReport,
      saveReportLogTool,
    ],
    model: MODEL,
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
  };

  const result = await runAgentLoop(config);

  // 4. 결과 로깅
  logger.step("\n[4/4] Agent result:");
  logger.info("Result", `Success: ${result.success}`);
  logger.info(
    "Result",
    `Tokens: ${result.tokensUsed.input} input / ${result.tokensUsed.output} output`,
  );
  logger.info("Result", `Tool calls: ${result.toolCalls}`);
  logger.info("Result", `Iterations: ${result.iterationCount}`);
  logger.info(
    "Result",
    `Time: ${(result.executionTimeMs / 1000).toFixed(1)}s`,
  );

  const inputCost = (result.tokensUsed.input / 1_000_000) * OPUS_INPUT_COST_PER_M;
  const outputCost = (result.tokensUsed.output / 1_000_000) * OPUS_OUTPUT_COST_PER_M;
  logger.info("Result", `Estimated cost: $${(inputCost + outputCost).toFixed(3)}`);

  if (result.success === false) {
    throw new Error(`Agent failed: ${result.error}`);
  }

  await pool.end();
  logger.step("\nDone.");
}

main().catch(async (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error("Agent", `Fatal: ${errorMsg}`);

  await sendDiscordError(errorMsg);
  await pool.end();
  process.exit(1);
});
