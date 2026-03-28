import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { runAgentLoop } from "./agentLoop";
import { buildDailySystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "@/lib/discord";
import { logger } from "@/lib/logger";
import type { AgentConfig } from "@/tools/types";

// Tools
import { getIndexReturns } from "@/tools/getIndexReturns";
import { getMarketBreadth } from "@/tools/getMarketBreadth";
import { getLeadingSectors } from "@/tools/getLeadingSectors";
import { getStockDetail } from "@/tools/getStockDetail";
import { getUnusualStocks } from "@/tools/getUnusualStocks";
import { getPhase1LateStocks } from "@/tools/getPhase1LateStocks";
import { getRisingRS } from "@/tools/getRisingRS";
import { searchCatalyst } from "@/tools/searchCatalyst";
import { getWatchlistStatus } from "@/tools/getWatchlistStatus";
import { saveReportLogTool } from "@/tools/saveReportLog";
import {
  createDraftCaptureTool,
  runReviewPipeline,
  draftsToFullContent,
  type ReportDraft,
} from "./reviewAgent";
import { runDailyQA, type DailyQAResult } from "./dailyQA";
import { reportQAIssue } from "@/lib/qaIssueReporter";
import { filterDeclinedSymbols, formatDeclineWarning } from "@/lib/priceDeclineFilter";
import type { AgentTool } from "@/tools/types";
import type { ReportData } from "@/lib/factChecker";
import {
  loadActiveTheses,
  formatThesesForPrompt,
} from "@/debate/thesisStore";
import { formatChainsForDailyPrompt } from "@/lib/narrativeChainStats";
import { loadTodayDebateInsight } from "@/debate/sessionStore";
import { loadPreviousReportContext } from "@/lib/previousReportContext";

import { CLAUDE_SONNET } from "@/lib/models.js";

const MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 15;

/**
 * saveReportLogTool을 래핑하여 reportData를 캡처한다.
 * QA에서 DB 대조 시 사용.
 */
function createReportLogCaptureTool(
  captured: { data: ReportData | null },
): AgentTool {
  return {
    definition: saveReportLogTool.definition,
    async execute(input) {
      const rawData = input.report_data as Record<string, unknown> | undefined;
      if (
        rawData != null &&
        Array.isArray(rawData.reportedSymbols) &&
        rawData.marketSummary != null &&
        typeof rawData.marketSummary === "object"
      ) {
        captured.data = {
          reportedSymbols: rawData.reportedSymbols as ReportData["reportedSymbols"],
          marketSummary: rawData.marketSummary as ReportData["marketSummary"],
        };
      }
      return saveReportLogTool.execute(input);
    },
  };
}

/**
 * QA warn 이상 severity 시 경고 블록이 앞에 삽입된 새 drafts 배열을 반환한다.
 * 원본 drafts는 변경하지 않는다.
 */
export function withQAWarning(drafts: ReportDraft[], qaResult: DailyQAResult): ReportDraft[] {
  if (drafts.length === 0) return drafts;

  const lines = qaResult.mismatches.map((m) =>
    `- ${m.field}: 리포트 ${m.actual} / DB 실측 ${m.expected}`,
  );

  const warningBlock = [
    "⚠️ **[데이터 정합성 경고]**",
    ...lines,
    "분석 참고 시 유의 요망.\n",
  ].join("\n");

  const [first, ...rest] = drafts;
  return [{ ...first, message: `${warningBlock}\n${first.message}` }, ...rest];
}

// Sonnet 4 pricing (USD per 1M tokens, as of 2026-03)
const SONNET_INPUT_COST_PER_M = 3;
const SONNET_OUTPUT_COST_PER_M = 15;

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
  logger.step("[1/9] Environment validated");

  // 2. 최신 거래일 확인
  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.step("No trade date found. Skipping.");
    await sendDiscordMessage("📊 오늘은 거래일이 아닙니다. Agent 실행을 스킵합니다.");
    await pool.end();
    return;
  }
  logger.step(`[2/9] Target date: ${targetDate}`);

  // 3. 애널리스트 토론 전망 로드
  let thesesContext = "";
  try {
    const activeTheses = await loadActiveTheses();
    thesesContext = formatThesesForPrompt(activeTheses);
    if (thesesContext !== "") {
      logger.info("Thesis", `Loaded ${activeTheses.length} active theses`);
    } else {
      logger.info("Thesis", "No active theses");
    }
  } catch (err) {
    logger.warn("Thesis", `Failed to load theses: ${err instanceof Error ? err.message : String(err)}`);
  }
  logger.step("[3/9] Theses loaded");

  // 4. 활성 서사 체인 로드
  let narrativeChainsContext = "";
  try {
    narrativeChainsContext = await formatChainsForDailyPrompt();
    if (narrativeChainsContext !== "") {
      logger.info("NarrativeChain", "활성 서사 체인 컨텍스트 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("NarrativeChain", `로드 실패 (에이전트는 계속 진행): ${reason}`);
  }
  logger.step("[4/9] Narrative chains loaded");

  // 5. 오늘의 토론 인사이트 로드 (fail-open — 없으면 빈 문자열)
  const debateInsight = await loadTodayDebateInsight(targetDate);
  if (debateInsight !== "") {
    logger.info("DebateInsight", "오늘의 토론 인사이트 로드 완료");
  } else {
    logger.info("DebateInsight", "오늘의 토론 인사이트 없음 — [중단] 섹션 생략됨");
  }
  logger.step("[5/9] Debate insight loaded");

  // 5-B. 직전 리포트 컨텍스트 로드 (fail-open — 없으면 빈 문자열)
  const previousReportContext = await loadPreviousReportContext(targetDate);
  if (previousReportContext !== "") {
    logger.info("PreviousReport", "직전 리포트 컨텍스트 로드 완료");
  } else {
    logger.info("PreviousReport", "직전 리포트 없음 — 전일 비교 컨텍스트 미주입");
  }

  // 6. Agent 실행 (draft 모드 — 리포트는 캡처만, 발송은 리뷰 후)
  logger.step("[6/9] Running agent loop...\n");

  const reportDrafts: ReportDraft[] = [];
  const capturedReport: { data: ReportData | null } = { data: null };

  const config: AgentConfig = {
    targetDate,
    systemPrompt: buildDailySystemPrompt({ targetDate, thesesContext, narrativeChainsContext, debateInsight, previousReportContext }),
    tools: [
      getIndexReturns,
      getMarketBreadth,
      getLeadingSectors,
      getUnusualStocks,
      getPhase1LateStocks,
      getRisingRS,
      searchCatalyst,
      getStockDetail,
      getWatchlistStatus,
      createDraftCaptureTool(reportDrafts),
      createReportLogCaptureTool(capturedReport),
    ],
    model: MODEL,
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
  };

  // 에이전트 루프 실행 — 에러 발생해도 draft가 캡처됐으면 발송 진행
  let loopError: string | null = null;
  try {
    const result = await runAgentLoop(config);

    logger.step("\n[7/9] Agent result:");
    logger.info("Result", `Success: ${result.success}`);
    logger.info(
      "Result",
      `Tokens: ${result.tokensUsed.input} input / ${result.tokensUsed.output} output`,
    );
    if (result.tokensUsed.cacheRead > 0 || result.tokensUsed.cacheCreation > 0) {
      logger.info(
        "Result",
        `Cache: ${result.tokensUsed.cacheCreation} creation / ${result.tokensUsed.cacheRead} read`,
      );
    }
    logger.info("Result", `Tool calls: ${result.toolCalls}`);
    logger.info("Result", `Iterations: ${result.iterationCount}`);
    logger.info(
      "Result",
      `Time: ${(result.executionTimeMs / 1000).toFixed(1)}s`,
    );

    const CACHE_WRITE_COST_PER_M = SONNET_INPUT_COST_PER_M * 1.25;
    const CACHE_READ_COST_PER_M = SONNET_INPUT_COST_PER_M * 0.1;
    const inputCost =
      (result.tokensUsed.input / 1_000_000) * SONNET_INPUT_COST_PER_M +
      (result.tokensUsed.cacheCreation / 1_000_000) * CACHE_WRITE_COST_PER_M +
      (result.tokensUsed.cacheRead / 1_000_000) * CACHE_READ_COST_PER_M;
    const outputCost = (result.tokensUsed.output / 1_000_000) * SONNET_OUTPUT_COST_PER_M;
    logger.info("Result", `Estimated cost: $${(inputCost + outputCost).toFixed(3)}`);

    if (result.success === false) {
      loopError = result.error ?? "Unknown error";
      logger.error("Agent", `Agent loop failed: ${loopError}`);
    }
  } catch (err) {
    loopError = err instanceof Error ? err.message : String(err);
    logger.error("Agent", `Agent loop crashed: ${loopError}`);
  }

  // 8. QA: DB 원본 수치와 리포트 데이터 대조
  let finalDrafts = reportDrafts;
  if (capturedReport.data != null) {
    logger.step("[8/9] Running daily QA...");
    try {
      const qaResult = await runDailyQA(targetDate, capturedReport.data);
      logger.info("DailyQA", `severity: ${qaResult.severity}, mismatches: ${qaResult.mismatches.length}, checked: ${qaResult.checkedItems}`);

      if (qaResult.severity === "block" || qaResult.severity === "warn") {
        const level = qaResult.severity === "block" ? "BLOCK" : "WARN";
        logger.warn("DailyQA", `${level} — 경고 문구를 리포트에 삽입합니다`);
        finalDrafts = withQAWarning(reportDrafts, qaResult);
        await reportQAIssue(qaResult, targetDate, "daily");
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("DailyQA", `QA 실패 (발송은 계속 진행): ${reason}`);
    }
  } else {
    logger.info("DailyQA", "reportData 미캡처 — QA 스킵");
  }

  // 8-B. 급락 종목 경고 — QA 이후 실행 (비블로킹)
  if (capturedReport.data != null && capturedReport.data.reportedSymbols.length > 0) {
    try {
      const reportedSymbolNames = capturedReport.data.reportedSymbols.map((s) => s.symbol);
      const declined = await filterDeclinedSymbols(reportedSymbolNames, targetDate);

      if (declined.length > 0 && finalDrafts.length > 0) {
        const warningSection = formatDeclineWarning(declined, targetDate);
        const [first, ...rest] = finalDrafts;
        finalDrafts = [{ ...first, message: `${first.message}\n\n${warningSection}` }, ...rest];
        logger.warn("PriceDeclineFilter", `급락 경고 ${declined.length}건 — 리포트에 섹션 추가`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("PriceDeclineFilter", `급락 필터 실패 (발송은 계속 진행): ${reason}`);
    }
  }

  // 9. 리뷰 파이프라인 → 최종 발송 (루프 실패해도 draft가 있으면 발송)
  if (finalDrafts.length > 0) {
    logger.step("[9/9] Running review pipeline...");
    const sentDrafts = await runReviewPipeline(finalDrafts, "DISCORD_WEBHOOK_URL", { reportType: "daily" });

    // full_content DB 저장
    if (sentDrafts.length > 0) {
      const { updateReportFullContent } = await import("@/lib/reportLog");
      const fullContent = draftsToFullContent(sentDrafts);
      await updateReportFullContent(targetDate, "daily", fullContent);
    }
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
