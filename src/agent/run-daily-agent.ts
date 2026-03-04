import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { runAgentLoop } from "./agentLoop";
import { buildDailySystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "./discord";
import { logger } from "./logger";
import type { AgentConfig } from "./tools/types";

// Tools
import { getIndexReturns } from "./tools/getIndexReturns";
import { getMarketBreadth } from "./tools/getMarketBreadth";
import { getLeadingSectors } from "./tools/getLeadingSectors";
import { getStockDetail } from "./tools/getStockDetail";
import { getUnusualStocks } from "./tools/getUnusualStocks";
import { searchCatalyst } from "./tools/searchCatalyst";
import { saveReportLogTool } from "./tools/saveReportLog";
import {
  createDraftCaptureTool,
  runReviewPipeline,
  type ReportDraft,
} from "./reviewAgent";

const MODEL = "claude-opus-4-6";
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 15;

// Opus 4.6 pricing (USD per 1M tokens, as of 2026-03)
const OPUS_INPUT_COST_PER_M = 5;
const OPUS_OUTPUT_COST_PER_M = 25;

// Optional env vars (not validated here):
// - DISCORD_ERROR_WEBHOOK_URL: routes errors to a separate channel.
//   Falls back to DISCORD_WEBHOOK_URL if unset.
// - BRAVE_API_KEY: for catalyst search. If unset, catalyst search returns empty.
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
  logger.step("[1/5] Environment validated");

  // 2. 최신 거래일 확인
  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.step("No trade date found. Skipping.");
    await sendDiscordMessage("📊 오늘은 거래일이 아닙니다. Agent 실행을 스킵합니다.");
    await pool.end();
    return;
  }
  logger.step(`[2/5] Target date: ${targetDate}`);

  // 3. Agent 실행 (draft 모드 — 리포트는 캡처만, 발송은 리뷰 후)
  logger.step("[3/5] Running agent loop...\n");

  const reportDrafts: ReportDraft[] = [];

  const config: AgentConfig = {
    targetDate,
    systemPrompt: buildDailySystemPrompt(),
    tools: [
      getIndexReturns,
      getMarketBreadth,
      getLeadingSectors,
      getUnusualStocks,
      searchCatalyst,
      getStockDetail,
      createDraftCaptureTool(reportDrafts),
      saveReportLogTool,
    ],
    model: MODEL,
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
  };

  // 에이전트 루프 실행 — 에러 발생해도 draft가 캡처됐으면 발송 진행
  let loopError: string | null = null;
  try {
    const result = await runAgentLoop(config);

    logger.step("\n[4/5] Agent result:");
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
      loopError = result.error ?? "Unknown error";
      logger.error("Agent", `Agent loop failed: ${loopError}`);
    }
  } catch (err) {
    loopError = err instanceof Error ? err.message : String(err);
    logger.error("Agent", `Agent loop crashed: ${loopError}`);
  }

  // 5. 리뷰 파이프라인 → 최종 발송 (루프 실패해도 draft가 있으면 발송)
  if (reportDrafts.length > 0) {
    logger.step("[5/5] Running review pipeline...");
    await runReviewPipeline(reportDrafts, "DISCORD_WEBHOOK_URL");
  } else if (loopError != null) {
    throw new Error(`Agent failed with no drafts: ${loopError}`);
  } else {
    logger.warn("Agent", "No report drafts captured");
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
