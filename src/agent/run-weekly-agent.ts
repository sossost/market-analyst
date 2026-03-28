import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { runAgentLoop } from "./agentLoop";
import { buildWeeklySystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "@/lib/discord";
import { logger } from "@/lib/logger";
import type { AgentConfig } from "@/tools/types";

// Tools
import { getIndexReturns } from "@/tools/getIndexReturns";
import { getMarketBreadth } from "@/tools/getMarketBreadth";
import { getLeadingSectors } from "@/tools/getLeadingSectors";
import { getPhase2Stocks } from "@/tools/getPhase2Stocks";
import { getPhase1LateStocks } from "@/tools/getPhase1LateStocks";
import { getRisingRS } from "@/tools/getRisingRS";
import { getFundamentalAcceleration } from "@/tools/getFundamentalAcceleration";
import { getStockDetail } from "@/tools/getStockDetail";
import { searchCatalyst } from "@/tools/searchCatalyst";
import { readReportHistory } from "@/tools/readReportHistory";
import { saveReportLogTool } from "@/tools/saveReportLog";
// saveRecommendations, readRecommendationPerformance: 주간 에이전트 도구에서 제거됨.
// 코드 파일은 ETL 의존성이 있으므로 유지.
import { saveWatchlist } from "@/tools/saveWatchlist";
import { getWatchlistStatus } from "@/tools/getWatchlistStatus";
import { readRegimePerformance } from "@/tools/readRegimePerformance";
import {
  createDraftCaptureTool,
  runReviewPipeline,
  draftsToFullContent,
  type ReportDraft,
} from "./reviewAgent";
import {
  runFundamentalValidation,
  formatFundamentalSupplement,
} from "@/fundamental/runFundamentalValidation";
import {
  loadActiveTheses,
  formatThesesForPrompt,
} from "@/debate/thesisStore";
import { loadSignalPerformanceSummary } from "./signalPerformance";
import { formatChainsSummaryForPrompt } from "@/lib/narrativeChainStats";
import { formatLeadingSectorsForPrompt } from "@/lib/sectorLagStats";
import {
  loadRecentRegimes,
  loadPendingRegimes,
  formatRegimeForPrompt,
} from "@/debate/regimeStore";

import { CLAUDE_SONNET } from "@/lib/models.js";

const MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 15;

// Sonnet 4 pricing (USD per 1M tokens, as of 2026-03)
const SONNET_INPUT_COST_PER_M = 3;
const SONNET_OUTPUT_COST_PER_M = 15;

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
  logger.step("[1/7] Environment validated");

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
  logger.step(`[2/7] Target date: ${targetDate}`);

  // 3. 펀더멘탈 검증 (전체 활성 종목 SEPA 스코어링 → DB 저장)
  logger.step("[3/7] Running fundamental validation...");

  let fundamentalSupplement = "";
  try {
    const validationResult = await runFundamentalValidation();
    fundamentalSupplement = formatFundamentalSupplement(validationResult.scores, { includeHeader: false });

    logger.info("Fundamental", `${validationResult.scores.length}개 종목 검증 완료`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Fundamental", `검증 실패 (에이전트는 계속 진행): ${reason}`);
  }

  // 3.5. 애널리스트 토론 전망 로드
  let thesesContext = "";
  try {
    const activeTheses = await loadActiveTheses();
    thesesContext = formatThesesForPrompt(activeTheses);
    if (activeTheses.length > 0) {
      logger.info("Theses", `${activeTheses.length}개 ACTIVE thesis 로드 완료`);
    } else {
      logger.info("Theses", "ACTIVE thesis 없음 — 토론 컨텍스트 생략");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Theses", `로드 실패 (에이전트는 계속 진행): ${reason}`);
  }

  // 3.6. 활성 병목 체인 로드
  let narrativeChainsSummary = "";
  try {
    narrativeChainsSummary = await formatChainsSummaryForPrompt();
    if (narrativeChainsSummary !== "") {
      logger.info("NarrativeChain", "활성 병목 체인 요약 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("NarrativeChain", `로드 실패 (에이전트는 계속 진행): ${reason}`);
  }

  // 3.7. 섹터 시차 경보 로드
  let sectorLagContext = "";
  try {
    sectorLagContext = await formatLeadingSectorsForPrompt(targetDate);
    if (sectorLagContext !== "") {
      logger.info("SectorLag", "선행 섹터 시차 경보 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("SectorLag", `로드 실패 (에이전트는 계속 진행): ${reason}`);
  }

  // 3.8. 시장 레짐 히스토리 로드 (confirmed + pending)
  let regimeContext = "";
  try {
    const [recentRegimes, pendingRegimes] = await Promise.all([
      loadRecentRegimes(30),
      loadPendingRegimes(),
    ]);
    regimeContext = formatRegimeForPrompt(recentRegimes, pendingRegimes);
    if (regimeContext !== "") {
      logger.info("Regime", "최근 레짐 히스토리 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Regime", `로드 실패 (에이전트는 계속 진행): ${reason}`);
  }

  // 3.9. 시그널 성과 로드
  const signalPerformance = loadSignalPerformanceSummary();
  if (signalPerformance !== "") {
    logger.info("Signal", "백테스트 성과 요약 로드 완료");
  }

  // 3.10. 관심종목 현황 사전 로드 (에이전트 컨텍스트 주입용 — 에이전트도 get_watchlist_status로 재조회)
  let watchlistContext = "";
  try {
    const watchlistRaw = await getWatchlistStatus.execute({ include_trajectory: false });
    const watchlistData = JSON.parse(watchlistRaw) as {
      count?: number;
      summary?: { totalActive: number; phaseChanges: unknown[] };
      items?: unknown[];
    };
    const totalActive = watchlistData.summary?.totalActive ?? watchlistData.count ?? 0;
    if (totalActive > 0) {
      watchlistContext = `현재 ACTIVE 관심종목 ${totalActive}개 추적 중`;
      const phaseChanges = watchlistData.summary?.phaseChanges;
      if (Array.isArray(phaseChanges) && phaseChanges.length > 0) {
        watchlistContext += ` (Phase 전이 ${phaseChanges.length}건 감지)`;
      }
      logger.info("Watchlist", `관심종목 현황 로드 완료: ACTIVE ${totalActive}개`);
    } else {
      logger.info("Watchlist", "ACTIVE 관심종목 없음 — 컨텍스트 생략");
    }
  } catch (err) {
    logger.warn("Watchlist", `관심종목 현황 로드 실패 (에이전트는 계속 진행): ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Agent 실행 (draft 모드 — 리포트는 캡처만, 발송은 리뷰 후)
  logger.step("[4/7] Running agent loop...\n");

  const reportDrafts: ReportDraft[] = [];

  const config: AgentConfig = {
    targetDate,
    systemPrompt: buildWeeklySystemPrompt({
      fundamentalSupplement,
      thesesContext,
      signalPerformance,
      narrativeChainsSummary,
      sectorLagContext,
      regimeContext,
      watchlistContext,
    }),
    tools: [
      getIndexReturns,
      getMarketBreadth,
      getLeadingSectors,
      getPhase2Stocks,
      getPhase1LateStocks,
      getRisingRS,
      getFundamentalAcceleration,
      getStockDetail,
      searchCatalyst,
      readReportHistory,
      readRegimePerformance,
      getWatchlistStatus,
      saveWatchlist,
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

    logger.step("\n[5/7] Agent result:");
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

    // 비용 계산: 캐시 읽기는 90% 할인, 캐시 쓰기는 25% 할증
    const CACHE_WRITE_COST_PER_M = SONNET_INPUT_COST_PER_M * 1.25;
    const CACHE_READ_COST_PER_M = SONNET_INPUT_COST_PER_M * 0.1;
    const inputCost =
      (result.tokensUsed.input / 1_000_000) * SONNET_INPUT_COST_PER_M +
      (result.tokensUsed.cacheCreation / 1_000_000) * CACHE_WRITE_COST_PER_M +
      (result.tokensUsed.cacheRead / 1_000_000) * CACHE_READ_COST_PER_M;
    const outputCost =
      (result.tokensUsed.output / 1_000_000) * SONNET_OUTPUT_COST_PER_M;
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
    logger.step("[6/7] Running review pipeline...");
    const sentDrafts = await runReviewPipeline(reportDrafts, "DISCORD_WEEKLY_WEBHOOK_URL", { reportType: "weekly" });

    // DB 저장: INSERT (레코드 생성) → UPDATE (full_content 추가)
    // 주간 에이전트는 save_report_log 도구를 안정적으로 호출하지 않으므로 코드 레벨에서 직접 INSERT.
    // saveReportLog는 onConflictDoNothing이므로, 에이전트가 도구 호출한 경우에도 안전.
    if (sentDrafts.length > 0) {
      const { saveReportLog, updateReportFullContent } = await import("@/lib/reportLog");
      const fullContent = draftsToFullContent(sentDrafts);

      await saveReportLog({
        date: targetDate,
        type: "weekly",
        reportedSymbols: [],
        marketSummary: { phase2Ratio: 0, leadingSectors: [], totalAnalyzed: 0 },
        fullContent: null,
        metadata: {
          model: MODEL,
          tokensUsed: { input: 0, output: 0 },
          toolCalls: 0,
          executionTime: 0,
        },
      });
      await updateReportFullContent(targetDate, "weekly", fullContent);
    }
  } else if (loopError != null) {
    throw new Error(`Agent failed with no drafts: ${loopError}`);
  } else {
    logger.warn("Agent", "No report drafts captured");
  }

  await pool.end();
  logger.step("\n[7/7] Done.");
}

main().catch(async (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error("Agent", `Fatal: ${errorMsg}`);

  await sendDiscordError(errorMsg);
  await pool.end();
  process.exit(1);
});
