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
import { saveRecommendations } from "@/tools/saveRecommendations";
import { readRecommendationPerformance } from "@/tools/readRecommendationPerformance";
import { saveWatchlist } from "@/tools/saveWatchlist";
import { getWatchlistStatus } from "@/tools/getWatchlistStatus";
import { readRegimePerformance } from "@/tools/readRegimePerformance";
import { createWeeklyDataCollector } from "@/tools/weeklyDataCollector";
import { createCaptureWeeklyInsightTool } from "@/tools/captureWeeklyInsight";
import type { WeeklyReportInsight } from "@/tools/schemas/weeklyReportSchema";
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
import { loadSectorClusterContext } from "@/lib/sectorClusterContext";
import {
  loadRecentRegimes,
  loadPendingRegimes,
  formatRegimeForPrompt,
} from "@/debate/regimeStore";
import { buildWeeklyHtml } from "@/lib/weekly-html-builder";
import { publishHtmlReport } from "@/lib/reportPublisher";
import { saveReportLog, updateReportFullContent } from "@/lib/reportLog";

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

async function publishWeeklyReport(
  html: string,
  insight: WeeklyReportInsight,
  targetDate: string,
): Promise<void> {
  const webhookEnvVar = "DISCORD_WEEKLY_WEBHOOK_URL";

  // Supabase Storage 업로드 시도
  const storageUrl = await (async (): Promise<string | null> => {
    try {
      return await publishHtmlReport(html, targetDate, "weekly");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("WeeklyAgent", `HTML 업로드 실패 — Discord 메시지만 발송: ${reason}`);
      return null;
    }
  })();

  // Discord 발송
  const discordText = storageUrl != null
    ? `${insight.discordMessage}\n\n📊 상세 리포트: ${storageUrl}`
    : insight.discordMessage;

  await sendDiscordMessage(discordText, webhookEnvVar);
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

  // 3.7-B. 업종 클러스터 컨텍스트 로드 (fail-open — 없으면 빈 문자열)
  let sectorClusterContext = "";
  try {
    sectorClusterContext = await loadSectorClusterContext(targetDate);
    if (sectorClusterContext !== "") {
      logger.info("SectorCluster", "업종 클러스터 컨텍스트 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("SectorCluster", `로드 실패 (에이전트는 계속 진행): ${reason}`);
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

  // 4. 데이터 컬렉터 + 인사이트 캡처 컨테이너 초기화
  logger.step("[4/7] Running agent loop...\n");

  const dataCollector = createWeeklyDataCollector();
  const capturedInsight: { insight: WeeklyReportInsight | null } = { insight: null };

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
      sectorClusterContext,
    }),
    tools: [
      // 데이터 캡처 래핑 도구들
      dataCollector.wrap(getIndexReturns, "indexReturns"),
      dataCollector.wrap(getMarketBreadth, "marketBreadth"),
      // getLeadingSectors는 mode에 따라 sectorRanking 또는 industryTop10으로 분기
      // 에이전트가 mode: "weekly"로 호출하면 sectorRanking 캡처
      // 에이전트가 mode: "industry"로 호출하면 industryTop10 캡처 시도 (텍스트 반환 시 생략)
      dataCollector.wrap(getLeadingSectors, "sectorRanking"),
      dataCollector.wrap(getWatchlistStatus, "watchlist"),
      dataCollector.wrap(getPhase2Stocks, "gate5Candidates"),
      // 비캡처 도구들 (agentLoop 분석에 사용)
      getPhase1LateStocks,
      getRisingRS,
      getFundamentalAcceleration,
      getStockDetail,
      searchCatalyst,
      readReportHistory,
      readRegimePerformance,
      saveWatchlist,
      saveRecommendations,
      readRecommendationPerformance,
      // 해석 캡처 도구 — 에이전트가 마지막에 정확히 1회 호출
      createCaptureWeeklyInsightTool(capturedInsight),
      saveReportLogTool,
    ],
    model: MODEL,
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
  };

  // 에이전트 루프 실행
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

  // 6. HTML 조립 + 발행
  logger.step("[6/7] Publishing weekly report...");

  if (capturedInsight.insight != null) {
    const reportData = dataCollector.toWeeklyReportData();
    const html = buildWeeklyHtml(reportData, capturedInsight.insight, targetDate);

    // HTML 발행 + Discord 발송
    await publishWeeklyReport(html, capturedInsight.insight, targetDate);

    // DB 저장
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
    await updateReportFullContent(targetDate, "weekly", html);

    logger.step("[6/7] Weekly report published successfully.");
  } else if (loopError != null) {
    throw new Error(`Agent failed with no insight captured: ${loopError}`);
  } else {
    logger.warn("Agent", "No insight captured — capture_weekly_insight was not called");
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
