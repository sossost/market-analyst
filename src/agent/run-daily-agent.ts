import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { runAgentLoop } from "./agentLoop";
import { buildSystemPrompt } from "./systemPrompt";
import { sendSlackError, sendSlackMessage } from "./slack";
import type { AgentConfig } from "./tools/types";

// Tools
import { getMarketBreadth } from "./tools/getMarketBreadth";
import { getLeadingSectors } from "./tools/getLeadingSectors";
import { getPhase2Stocks } from "./tools/getPhase2Stocks";
import { getStockDetail } from "./tools/getStockDetail";
import { readReportHistory } from "./tools/readReportHistory";
import { sendSlackReport } from "./tools/sendSlackReport";
import { saveReportLogTool } from "./tools/saveReportLog";

const MODEL = "claude-opus-4-6";
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 15;

function validateAgentEnvironment(): void {
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY", "SLACK_WEBHOOK_URL"];
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
  console.log("=== Agent Core: Daily Market Analysis ===\n");

  // 1. 환경변수 검증
  validateAgentEnvironment();
  console.log("[1/4] Environment validated");

  // 2. 최신 거래일 확인
  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    console.log("No trade date found. Skipping.");
    await sendSlackMessage("📊 오늘은 거래일이 아닙니다. Agent 실행을 스킵합니다.");
    await pool.end();
    return;
  }
  console.log(`[2/4] Target date: ${targetDate}`);

  // 3. Agent 실행
  console.log("[3/4] Running agent loop...\n");

  const config: AgentConfig = {
    targetDate,
    systemPrompt: buildSystemPrompt(),
    tools: [
      getMarketBreadth,
      getLeadingSectors,
      getPhase2Stocks,
      getStockDetail,
      readReportHistory,
      sendSlackReport,
      saveReportLogTool,
    ],
    model: MODEL,
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
  };

  const result = await runAgentLoop(config);

  // 4. 결과 로깅
  console.log("\n[4/4] Agent result:");
  console.log(`  Success: ${result.success}`);
  console.log(
    `  Tokens: ${result.tokensUsed.input} input / ${result.tokensUsed.output} output`,
  );
  console.log(`  Tool calls: ${result.toolCalls}`);
  console.log(`  Iterations: ${result.iterationCount}`);
  console.log(`  Time: ${(result.executionTimeMs / 1000).toFixed(1)}s`);

  // 비용 추정 (Opus 4.6: $5/1M input, $25/1M output)
  const inputCost = (result.tokensUsed.input / 1_000_000) * 5;
  const outputCost = (result.tokensUsed.output / 1_000_000) * 25;
  console.log(`  Estimated cost: $${(inputCost + outputCost).toFixed(3)}`);

  if (!result.success) {
    throw new Error(`Agent failed: ${result.error}`);
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch(async (err) => {
  console.error("\n=== Agent Core FAILED ===");
  console.error(err);

  // 슬랙 에러 알림
  const errorMsg = err instanceof Error ? err.message : String(err);
  await sendSlackError(errorMsg);

  await pool.end();
  process.exit(1);
});
