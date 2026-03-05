import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { runAgentLoop } from "./agentLoop";
import { buildWeeklySystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "./discord";
import { logger } from "./logger";
import type { AgentConfig } from "./tools/types";

// Tools
import { getIndexReturns } from "./tools/getIndexReturns";
import { getMarketBreadth } from "./tools/getMarketBreadth";
import { getLeadingSectors } from "./tools/getLeadingSectors";
import { getPhase2Stocks } from "./tools/getPhase2Stocks";
import { getStockDetail } from "./tools/getStockDetail";
import { searchCatalyst } from "./tools/searchCatalyst";
import { readReportHistory } from "./tools/readReportHistory";
import { saveReportLogTool } from "./tools/saveReportLog";
import { saveRecommendations } from "./tools/saveRecommendations";
import { readRecommendationPerformance } from "./tools/readRecommendationPerformance";
import {
  createDraftCaptureTool,
  runReviewPipeline,
  type ReportDraft,
} from "./reviewAgent";
import {
  runFundamentalValidation,
  formatFundamentalSupplement,
} from "./fundamental/runFundamentalValidation";

const MODEL = "claude-opus-4-6";
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 20;

// Opus 4.6 pricing (USD per 1M tokens, as of 2026-03)
const OPUS_INPUT_COST_PER_M = 5;
const OPUS_OUTPUT_COST_PER_M = 25;

// Optional env vars (not validated here):
// - DISCORD_ERROR_WEBHOOK_URL: routes errors to a separate channel.
// - BRAVE_API_KEY: for catalyst search. If unset, catalyst search returns empty.
function validateAgentEnvironment(): void {
  const required = [
    "DATABASE_URL",
    "ANTHROPIC_API_KEY",
    "DISCORD_WEEKLY_WEBHOOK_URL",
  ];
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
  logger.step("=== Agent Core: Weekly Market Analysis ===\n");

  // 1. 환경변수 검증
  validateAgentEnvironment();
  logger.step("[1/6] Environment validated");

  // 2. 최신 거래일 확인 (금요일 데이터)
  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.step("No trade date found. Skipping.");
    await sendDiscordMessage(
      "📊 거래 데이터가 없습니다. 주간 Agent 실행을 스킵합니다.",
      "DISCORD_WEEKLY_WEBHOOK_URL",
    );
    await pool.end();
    return;
  }
  logger.step(`[2/6] Target date: ${targetDate}`);

  // 3. 펀더멘탈 검증 (Phase 2 종목 SEPA 스코어링 + S등급 리포트 발행)
  logger.step("[3/6] Running fundamental validation...");

  let fundamentalSupplement = "";
  try {
    const validationResult = await runFundamentalValidation();
    fundamentalSupplement = formatFundamentalSupplement(validationResult.scores);

    const { scores, reportsPublished, totalTokens } = validationResult;
    logger.info("Fundamental", `${scores.length}개 종목 검증 완료, S등급 리포트 ${reportsPublished.length}개 발행`);
    logger.info("Fundamental", `Sonnet tokens: ${totalTokens.input} input / ${totalTokens.output} output`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Fundamental", `검증 실패 (에이전트는 계속 진행): ${reason}`);
  }

  // 4. Agent 실행 (draft 모드 — 리포트는 캡처만, 발송은 리뷰 후)
  logger.step("[4/6] Running agent loop...\n");

  const reportDrafts: ReportDraft[] = [];

  const config: AgentConfig = {
    targetDate,
    systemPrompt: buildWeeklySystemPrompt(fundamentalSupplement),
    tools: [
      getIndexReturns,
      getMarketBreadth,
      getLeadingSectors,
      getPhase2Stocks,
      getStockDetail,
      searchCatalyst,
      readReportHistory,
      readRecommendationPerformance,
      createDraftCaptureTool(reportDrafts),
      saveReportLogTool,
      saveRecommendations,
    ],
    model: MODEL,
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
  };

  // 에이전트 루프 실행 — 에러 발생해도 draft가 캡처됐으면 발송 진행
  let loopError: string | null = null;
  try {
    const result = await runAgentLoop(config);

    logger.step("\n[5/6] Agent result:");
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

    const inputCost =
      (result.tokensUsed.input / 1_000_000) * OPUS_INPUT_COST_PER_M;
    const outputCost =
      (result.tokensUsed.output / 1_000_000) * OPUS_OUTPUT_COST_PER_M;
    logger.info(
      "Result",
      `Estimated cost: $${(inputCost + outputCost).toFixed(3)}`,
    );

    if (result.success === false) {
      loopError = result.error ?? "Unknown error";
      logger.error("Agent", `Agent loop failed: ${loopError}`);
    }
  } catch (err) {
    loopError = err instanceof Error ? err.message : String(err);
    logger.error("Agent", `Agent loop crashed: ${loopError}`);
  }

  // 6. 리뷰 파이프라인 → 최종 발송 (루프 실패해도 draft가 있으면 발송)
  if (reportDrafts.length > 0) {
    logger.step("[6/6] Running review pipeline...");
    await runReviewPipeline(reportDrafts, "DISCORD_WEEKLY_WEBHOOK_URL");
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
