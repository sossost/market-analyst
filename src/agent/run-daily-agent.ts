import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { buildDailySystemPrompt } from "./prompts/daily";
import { sendDiscordError, sendDiscordMessage } from "@/lib/discord";
import { logger } from "@/lib/logger";

// Tools — 데이터 수집용 직접 호출
import { getIndexReturns } from "@/tools/getIndexReturns";
import { getMarketBreadth } from "@/tools/getMarketBreadth";
import { getLeadingSectors } from "@/tools/getLeadingSectors";
import { getUnusualStocks } from "@/tools/getUnusualStocks";
import { getRisingRS } from "@/tools/getRisingRS";
import { getWatchlistStatus } from "@/tools/getWatchlistStatus";

// 업종 RS — 일간은 절대 RS 상위 + 섹터캡 (주간의 변화량 정렬과 분리)
import { findTopIndustriesGlobal } from "@/db/repositories/index";
import { applyIndustrySectorCap } from "@/lib/industryFilter";
import { toNum } from "@/etl/utils/common";
import { clampPercent } from "@/tools/validation";

// Schema + Builder
import type {
  DailyReportData,
  DailyReportInsight,
  DailyBreadthSnapshot,
} from "@/tools/schemas/dailyReportSchema";
import { fillInsightDefaults } from "@/tools/schemas/dailyReportSchema";
import { buildDailyHtml } from "@/lib/daily-html-builder";

// LLM Provider — CLI 단발 호출 (API $0)
import { ClaudeCliProvider } from "@/debate/llm/claudeCliProvider";

// Publish + DB
import { publishHtmlReport } from "@/lib/reportPublisher";
import { saveReportLog, updateReportFullContent } from "@/lib/reportLog";

// Context loaders
import {
  loadActiveTheses,
  formatThesesForPrompt,
} from "@/debate/thesisStore";
import { formatChainsForDailyPrompt } from "@/lib/narrativeChainStats";
import { loadTodayDebateInsight } from "@/debate/sessionStore";
import { loadPreviousReportContext } from "@/lib/previousReportContext";
import { loadSectorClusterContext } from "@/lib/sectorClusterContext";
import { loadConfirmedRegime } from "@/debate/regimeStore";

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function parse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return { error: "JSON parse failed" };
  }
}

function validateEnvironment(): void {
  const required = ["DATABASE_URL", "DISCORD_WEBHOOK_URL"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  // ANTHROPIC_API_KEY는 더 이상 필수가 아님 — CLI 사용
}

// ─── 데이터 수집 ──────────────────────────────────────────────────────────────

const EMPTY_BREADTH_SNAPSHOT: DailyBreadthSnapshot = {
  date: "",
  totalStocks: 0,
  phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
  phase2Ratio: 0,
  phase2RatioChange: 0,
  marketAvgRs: 0,
  advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
  newHighLow: { newHighs: 0, newLows: 0, ratio: null },
  breadthScore: null,
  divergenceSignal: null,
  topSectors: [],
};

async function collectDailyData(targetDate: string): Promise<DailyReportData> {
  logger.step("[4/8] Collecting data from tools...");

  // 독립 도구 병렬 호출
  const [
    indexRaw,
    breadthRaw,
    sectorRaw,
    industryRaw,
    unusualRaw,
    risingRsRaw,
    watchlistRaw,
  ] = await Promise.all([
    getIndexReturns.execute({ mode: "daily", date: targetDate }).catch((err: unknown) => {
      logger.warn("Tool", `getIndexReturns 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ indices: [], fearGreed: null });
    }),
    getMarketBreadth.execute({ mode: "daily", date: targetDate }).catch((err: unknown) => {
      logger.warn("Tool", `getMarketBreadth 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ error: "failed" });
    }),
    getLeadingSectors.execute({ mode: "daily", date: targetDate }).catch((err: unknown) => {
      logger.warn("Tool", `getLeadingSectors(sector) 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ sectors: [] });
    }),
    // 업종은 도구 대신 직접 쿼리 — 일간은 절대 RS 상위 + 섹터캡, 주간의 변화량 경로와 분리
    findTopIndustriesGlobal(targetDate, 50).then((rows) =>
      JSON.stringify({ industries: rows }),
    ).catch((err: unknown) => {
      logger.warn("Tool", `findTopIndustriesGlobal 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ industries: [] });
    }),
    getUnusualStocks.execute({ date: targetDate }).catch((err: unknown) => {
      logger.warn("Tool", `getUnusualStocks 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ stocks: [] });
    }),
    getRisingRS.execute({ date: targetDate }).catch((err: unknown) => {
      logger.warn("Tool", `getRisingRS 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ stocks: [] });
    }),
    getWatchlistStatus.execute({ include_trajectory: false, date: targetDate }).catch((err: unknown) => {
      logger.warn("Tool", `getWatchlistStatus 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ summary: { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 }, items: [] });
    }),
  ]);

  const indexData = parse(indexRaw);
  const breadthData = parse(breadthRaw);
  const sectorData = parse(sectorRaw);
  const industryData = parse(industryRaw);
  const unusualData = parse(unusualRaw);
  const risingRsData = parse(risingRsRaw);
  const watchlistData = parse(watchlistRaw);

  const MIN_VOL_RATIO = 1.0;
  const rawUnusualStocks = (Array.isArray(unusualData.stocks) ? unusualData.stocks : []) as DailyReportData["unusualStocks"];
  const filteredUnusualStocks = rawUnusualStocks.filter(
    (s) => s.volRatio >= MIN_VOL_RATIO && !s.splitSuspect,
  );

  const data: DailyReportData = {
    indexReturns: Array.isArray(indexData.indices) ? indexData.indices as DailyReportData["indexReturns"] : [],
    fearGreed: (indexData.fearGreed ?? null) as DailyReportData["fearGreed"],
    marketBreadth: breadthData.error != null
      ? { ...EMPTY_BREADTH_SNAPSHOT, date: targetDate }
      : (breadthData.snapshot ?? breadthData) as DailyBreadthSnapshot,
    sectorRanking: (Array.isArray(sectorData.sectors) ? sectorData.sectors : []) as DailyReportData["sectorRanking"],
    industryTop10: applyIndustrySectorCap(
      (Array.isArray(industryData.industries) ? industryData.industries : []).map((i: Record<string, unknown>) => ({
        industry: String(i.industry ?? ""),
        sector: String(i.sector ?? ""),
        avgRs: toNum(i.avg_rs ?? i.avgRs ?? 0),
        rsRank: Number(i.rs_rank ?? i.rsRank ?? 0),
        groupPhase: Number(i.group_phase ?? i.groupPhase ?? 0),
        phase2Ratio: clampPercent(
          Number((toNum(i.phase2_ratio ?? i.phase2Ratio ?? 0) * (String(i.phase2_ratio ?? "").includes(".") && toNum(i.phase2_ratio ?? 0) < 1 ? 100 : 1)).toFixed(1)),
          `industry:${i.industry}:phase2Ratio`,
        ),
        change4w: i.change_4w != null || i.change4w != null ? toNum(i.change_4w ?? i.change4w ?? 0) : null,
        change8w: i.change_8w != null || i.change8w != null ? toNum(i.change_8w ?? i.change8w ?? 0) : null,
        change12w: i.change_12w != null || i.change12w != null ? toNum(i.change_12w ?? i.change12w ?? 0) : null,
        sectorAvgRs: i.sector_avg_rs != null || i.sectorAvgRs != null ? toNum(i.sector_avg_rs ?? i.sectorAvgRs ?? 0) : null,
        sectorRsRank: i.sector_rs_rank != null || i.sectorRsRank != null ? Number(i.sector_rs_rank ?? i.sectorRsRank ?? 0) : null,
        divergence: null,
        changeWeek: null,
      })),
      2,
      10,
    ) as DailyReportData["industryTop10"],
    unusualStocks: filteredUnusualStocks,
    risingRS: (Array.isArray(risingRsData.stocks) ? risingRsData.stocks : []) as DailyReportData["risingRS"],
    watchlist: {
      summary: (watchlistData.summary ?? { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 }) as DailyReportData["watchlist"]["summary"],
      items: Array.isArray(watchlistData.items) ? watchlistData.items as DailyReportData["watchlist"]["items"] : [],
    },
  };

  logger.info(
    "Data",
    `지수 ${data.indexReturns.length} | 섹터 ${data.sectorRanking.length} | 업종 ${data.industryTop10.length} | 특이종목 ${data.unusualStocks.length}건 (원본 ${rawUnusualStocks.length}건, volRatio<1.0 또는 splitSuspect 제외) | RS상승 ${data.risingRS.length} | 관심종목 ${data.watchlist.summary.totalActive}`,
  );

  return data;
}

// ─── LLM 인사이트 생성 ────────────────────────────────────────────────────────

function buildInsightPrompt(data: DailyReportData, systemPrompt: string): { system: string; user: string } {
  const indexLines = data.indexReturns
    .map((i) => `${i.name}: ${i.close} (${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%)`)
    .join("\n");

  const fearGreedLine = data.fearGreed != null
    ? `Fear & Greed: ${data.fearGreed.score} (${data.fearGreed.rating})`
    : "";

  const breadth = data.marketBreadth;
  const ad = breadth.advanceDecline;
  const hl = breadth.newHighLow;

  const breadthLines = [
    `Phase 2 비율: ${breadth.phase2Ratio.toFixed(1)}% (전일 대비 ${breadth.phase2RatioChange >= 0 ? "+" : ""}${breadth.phase2RatioChange.toFixed(1)}%)`,
    `Phase 분포: P1 ${breadth.phaseDistribution.phase1} / P2 ${breadth.phaseDistribution.phase2} / P3 ${breadth.phaseDistribution.phase3} / P4 ${breadth.phaseDistribution.phase4}`,
    `시장 평균 RS: ${breadth.marketAvgRs.toFixed(1)}`,
    `A/D: 상승 ${ad.advancers} / 하락 ${ad.decliners} / 보합 ${ad.unchanged}${ad.ratio != null ? ` (비율 ${ad.ratio.toFixed(2)})` : ""}`,
    `신고가/신저가: 신고가 ${hl.newHighs} / 신저가 ${hl.newLows}`,
    breadth.divergenceSignal != null ? `Divergence: ${breadth.divergenceSignal}` : "",
  ].filter((l) => l !== "").join("\n");

  const sectorLines = data.sectorRanking
    .map((s) => `${s.rsRank}. ${s.sector}: RS ${s.avgRs.toFixed(1)} (${s.rsChange != null && s.rsChange >= 0 ? "+" : ""}${s.rsChange?.toFixed(1) ?? "—"}) Phase ${s.groupPhase} P2비율 ${s.phase2Ratio.toFixed(1)}%`)
    .join("\n");

  const industryLines = data.industryTop10
    .slice(0, 10)
    .map((i, idx) => `${idx + 1}. ${i.industry} (${i.sector}): RS ${i.avgRs.toFixed(1)} 4주변화 ${i.change4w != null ? (i.change4w >= 0 ? "+" : "") + i.change4w.toFixed(1) : "—"}`)
    .join("\n");

  const unusualLines = data.unusualStocks
    .slice(0, 10)
    .map((s) => `${s.symbol} [P${s.phase}] ${s.dailyReturn >= 0 ? "+" : ""}${s.dailyReturn.toFixed(1)}% 거래량×${s.volRatio.toFixed(1)} ${s.sector ?? "—"} | ${s.conditions.join(",")}`)
    .join("\n");

  const risingRsLines = data.risingRS
    .slice(0, 10)
    .map((s) => `${s.symbol} [P${s.phase}] RS ${s.rsScore} (+${s.rsChange?.toFixed(0) ?? "?"}) ${s.sector ?? "—"} / ${s.industry ?? "—"}`)
    .join("\n");

  const watchlistLine = `ACTIVE: ${data.watchlist.summary.totalActive}개, 평균 P&L: ${data.watchlist.summary.avgPnlPercent.toFixed(1)}%`;
  const watchlistItemLines = data.watchlist.items
    .map((w) => `${w.symbol}: Phase ${w.currentPhase ?? w.entryPhase}, RS ${w.currentRsScore ?? w.entryRsScore ?? "—"}, P&L ${w.pnlPercent?.toFixed(1) ?? "—"}%`)
    .join("\n") || "없음";

  const dataSummary = `아래는 오늘 수집된 시장 데이터입니다. 이 데이터를 기반으로 해석을 JSON으로 작성하세요.

## 지수 수익률
${indexLines}
${fearGreedLine}

## 시장 브레드스
${breadthLines}

## 섹터 로테이션 (11개)
${sectorLines}

## 업종 RS Top 10
${industryLines}

## 특이종목 (${data.unusualStocks.length}건)
${unusualLines || "없음"}

## RS 상승 초기 종목 (${data.risingRS.length}건)
${risingRsLines || "없음"}

## 관심종목
${watchlistLine}
${watchlistItemLines}

---

위 데이터를 분석하여 아래 JSON으로만 응답하세요. 다른 텍스트 금지.`;

  return { system: systemPrompt, user: dataSummary };
}

async function generateInsight(
  data: DailyReportData,
  systemPrompt: string,
): Promise<DailyReportInsight> {
  logger.step("[5/8] Generating insight via Claude CLI...");

  const cli = new ClaudeCliProvider("claude-sonnet-4-6", 600_000); // 10분 타임아웃
  const { system, user } = buildInsightPrompt(data, systemPrompt);

  try {
    const result = await cli.call({ systemPrompt: system, userMessage: user });
    logger.info("CLI", `Tokens: ${result.tokensUsed.input} input / ${result.tokensUsed.output} output`);

    const content = result.content.trim();
    // JSON 블록이 ```json ... ``` 로 감싸져 있을 수 있음
    const jsonStr = content.startsWith("```")
      ? content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
      : content;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.warn("CLI", `JSON 파싱 실패 — 기본값으로 폴백. 응답 앞 200자: ${content.slice(0, 200)}`);
      return fillInsightDefaults({});
    }

    return fillInsightDefaults(parsed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("CLI", `LLM 호출 실패: ${reason}`);
    return fillInsightDefaults({});
  }
}

// ─── 발행 ─────────────────────────────────────────────────────────────────────

async function publishDailyReport(
  html: string,
  insight: DailyReportInsight,
  targetDate: string,
): Promise<void> {
  const storageUrl = await (async (): Promise<string | null> => {
    try {
      return await publishHtmlReport(html, targetDate, "daily");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("Publish", `HTML 업로드 실패 — Discord 메시지만 발송: ${reason}`);
      return null;
    }
  })();

  const discordText = storageUrl != null
    ? `${insight.discordMessage}\n\n📊 상세 리포트: ${storageUrl}`
    : insight.discordMessage;

  await sendDiscordMessage(discordText, "DISCORD_WEBHOOK_URL");
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.step("=== Agent Core: Daily Market Analysis (CLI Mode) ===\n");

  // 1. 환경변수 검증
  validateEnvironment();
  logger.step("[1/8] Environment validated");

  // 2. 최신 거래일 확인
  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.step("No trade date found. Skipping.");
    await sendDiscordMessage("📊 오늘은 거래일이 아닙니다. Agent 실행을 스킵합니다.");
    await pool.end();
    return;
  }
  logger.step(`[2/8] Target date: ${targetDate}`);

  // 3. 컨텍스트 로딩
  logger.step("[3/8] Loading contexts...");

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

  let narrativeChainsContext = "";
  try {
    narrativeChainsContext = await formatChainsForDailyPrompt();
    if (narrativeChainsContext !== "") {
      logger.info("NarrativeChain", "활성 서사 체인 컨텍스트 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("NarrativeChain", `로드 실패 (계속 진행): ${reason}`);
  }

  let sectorClusterContext = "";
  try {
    sectorClusterContext = await loadSectorClusterContext(targetDate);
    if (sectorClusterContext !== "") {
      logger.info("SectorCluster", "업종 클러스터 컨텍스트 로드 완료");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("SectorCluster", `로드 실패 (계속 진행): ${reason}`);
  }

  let regimeContext = "";
  try {
    const confirmedRegime = await loadConfirmedRegime();
    if (confirmedRegime != null) {
      const confirmedAt = confirmedRegime.confirmedAt ?? confirmedRegime.regimeDate;
      const confirmedDate = new Date(`${confirmedAt}T00:00:00Z`);
      const targetDateObj = new Date(`${targetDate}T00:00:00Z`);
      const consecutiveDays =
        Math.floor((targetDateObj.getTime() - confirmedDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      regimeContext = `현재 시장 레짐: ${confirmedRegime.regime} (확정일: ${confirmedAt}, 경과일수: ${consecutiveDays}일)`;
      logger.info("Regime", `현재 확정 레짐: ${confirmedRegime.regime} (${confirmedAt}부터 ${consecutiveDays}일)`);
    } else {
      logger.info("Regime", "확정 레짐 없음 — 레짐 컨텍스트 생략");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("Regime", `레짐 로드 실패 (계속 진행): ${reason}`);
  }

  const debateInsight = await loadTodayDebateInsight(targetDate);
  if (debateInsight !== "") {
    logger.info("DebateInsight", "오늘의 토론 인사이트 로드 완료");
  } else {
    logger.info("DebateInsight", "오늘의 토론 인사이트 없음");
  }

  const previousReportContext = await loadPreviousReportContext(targetDate);
  if (previousReportContext !== "") {
    logger.info("PreviousReport", "직전 리포트 컨텍스트 로드 완료");
  } else {
    logger.info("PreviousReport", "직전 리포트 없음");
  }

  const systemPrompt = buildDailySystemPrompt({
    targetDate,
    thesesContext,
    narrativeChainsContext,
    debateInsight,
    previousReportContext,
    sectorClusterContext,
    regimeContext,
  });

  // 4. 데이터 수집 (도구 직접 호출 — 병렬)
  const data = await collectDailyData(targetDate);

  // 5. LLM 인사이트 생성 (CLI 단발 호출)
  const insight = await generateInsight(data, systemPrompt);

  // 6. HTML 조립 + 발행
  logger.step("[6/8] Building and publishing report...");
  const html = buildDailyHtml(data, insight, targetDate);

  logger.info("HTML", `Generated (${(html.length / 1024).toFixed(1)} KB)`);

  await publishDailyReport(html, insight, targetDate);

  // 7. DB 저장
  logger.step("[7/8] Saving to DB...");
  try {
    await saveReportLog({
      date: targetDate,
      type: "daily",
      reportedSymbols: [],
      marketSummary: {
        phase2Ratio: data.marketBreadth.phase2Ratio,
        leadingSectors: data.sectorRanking.slice(0, 3).map((s) => s.sector),
        totalAnalyzed: data.marketBreadth.phaseDistribution.phase1
          + data.marketBreadth.phaseDistribution.phase2
          + data.marketBreadth.phaseDistribution.phase3
          + data.marketBreadth.phaseDistribution.phase4,
      },
      fullContent: null,
      metadata: {
        model: "claude-sonnet-4-6 (CLI)",
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        executionTime: 0,
      },
    });
    await updateReportFullContent(targetDate, "daily", html);
  } catch (err) {
    logger.warn("DB", `리포트 저장 실패 (발행은 완료): ${err instanceof Error ? err.message : String(err)}`);
  }

  await pool.end();
  logger.step("\n[8/8] Done.");
}

main().catch(async (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error("Agent", `Fatal: ${errorMsg}`);

  await sendDiscordError(errorMsg);
  await pool.end();
  process.exit(1);
});
