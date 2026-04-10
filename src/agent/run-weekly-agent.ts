import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { buildWeeklySystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "@/lib/discord";
import { logger } from "@/lib/logger";

// Tools — 데이터 수집용 직접 호출
import { getIndexReturns } from "@/tools/getIndexReturns";
import { getMarketBreadth } from "@/tools/getMarketBreadth";
import { getLeadingSectors } from "@/tools/getLeadingSectors";
import { getPhase2Stocks } from "@/tools/getPhase2Stocks";
import { getWatchlistStatus } from "@/tools/getWatchlistStatus";
import { getVCPCandidates } from "@/tools/getVCPCandidates";
import { getConfirmedBreakouts } from "@/tools/getConfirmedBreakouts";
import { getSectorLagPatterns } from "@/tools/getSectorLagPatterns";
import { buildThesisAlignedCandidates } from "@/lib/thesisAlignedCandidates";
import { certifyThesisAlignedCandidates } from "@/lib/certifyThesisAligned";

// Schema + Builder
import type {
  WeeklyReportData,
  WeeklyReportInsight,
  MarketBreadthData,
  IndustryItem,
} from "@/tools/schemas/weeklyReportSchema";
import { fillInsightDefaults } from "@/tools/schemas/weeklyReportSchema";
import { buildWeeklyHtml } from "@/lib/weekly-html-builder";

// LLM Provider — CLI 단발 호출 (API $0)
import { ClaudeCliProvider } from "@/debate/llm/claudeCliProvider";

// Publish + DB
import { publishHtmlReport } from "@/lib/reportPublisher";
import { saveReportLog, updateReportFullContent } from "@/lib/reportLog";

// Context loaders
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

// ─── 유틸 ───────────────────────────────────────────────────────────────────

function parse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return { error: `JSON parse failed` };
  }
}

function colorClass(value: number): "up" | "down" | "neutral-color" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral-color";
}

function validateEnvironment(): void {
  const required = ["DATABASE_URL", "DISCORD_WEEKLY_WEBHOOK_URL"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  // ANTHROPIC_API_KEY는 더 이상 필수가 아님 — CLI 사용
}

// ─── 데이터 수집 ────────────────────────────────────────────────────────────

async function collectWeeklyData(targetDate: string): Promise<WeeklyReportData> {
  logger.step("[4/7] Collecting data from tools...");

  // 병렬 호출
  const [indexRaw, breadthRaw, sectorRaw, industryRaw, watchlistRaw, phase2Raw, allIndustryRaw, thesisAlignedRaw, vcpRaw, breakoutRaw, lagRaw] =
    await Promise.all([
      getIndexReturns.execute({ mode: "weekly", date: targetDate }),
      getMarketBreadth.execute({ mode: "weekly", date: targetDate }),
      getLeadingSectors.execute({ mode: "weekly", date: targetDate }),
      getLeadingSectors.execute({ mode: "industry", limit: 10, date: targetDate }),
      getWatchlistStatus.execute({ include_trajectory: true, date: targetDate }),
      getPhase2Stocks.execute({ min_rs: 60, date: targetDate }),
      getLeadingSectors.execute({ mode: "industry", limit: 200, date: targetDate }),
      buildThesisAlignedCandidates(targetDate).catch((err: unknown) => {
        logger.warn("ThesisAligned", `수집 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),
      getVCPCandidates.execute({ date: targetDate }).catch((err: unknown) => {
        logger.warn("VCP", `수집 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),
      getConfirmedBreakouts.execute({ date: targetDate }).catch((err: unknown) => {
        logger.warn("Breakout", `수집 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),
      getSectorLagPatterns.execute({ transition: "1to2", entity_type: "sector" }).catch((err: unknown) => {
        logger.warn("SectorLag", `수집 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),
    ]);

  const indexData = parse(indexRaw);
  const breadthData = parse(breadthRaw);
  const sectorData = parse(sectorRaw);
  const industryData = parse(industryRaw);
  const watchlistData = parse(watchlistRaw);
  const phase2Data = parse(phase2Raw);
  const allIndustryData = parse(allIndustryRaw);

  const indices = Array.isArray(indexData.indices) ? indexData.indices : [];
  const allIndustries = Array.isArray(allIndustryData.industries) ? allIndustryData.industries : [];

  // 4/5 예비종목 판정
  const industryChangeMap = new Map<string, number>();
  for (const ind of allIndustries as Array<{ industry: string; changeWeek: number | null }>) {
    if (ind.changeWeek != null) industryChangeMap.set(ind.industry, ind.changeWeek);
  }

  const stocks = Array.isArray(phase2Data.stocks) ? phase2Data.stocks : [];
  const pending4of5 = (stocks as Array<{ symbol: string; industry: string | null; rsScore: number; sepaGrade: string | null }>)
    .filter((s) => {
      if (s.industry == null) return false;
      if (s.sepaGrade !== "S" && s.sepaGrade !== "A") return false;
      const change = industryChangeMap.get(s.industry);
      return change != null && change > 0;
    })
    .map((s) => ({
      symbol: s.symbol,
      action: "register" as const,
      reason: `4/5 통과 (thesis 미확인) — RS ${s.rsScore}, ${s.industry}`,
    }));

  const EMPTY_BREADTH: MarketBreadthData = {
    weeklyTrend: [], phase1to2Transitions: 0,
    latestSnapshot: {
      date: targetDate, totalStocks: 0,
      phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
      phase2Ratio: 0, phase2RatioChange: 0, marketAvgRs: 0,
      advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
      newHighLow: { newHighs: 0, newLows: 0, ratio: null },
      breadthScore: null, breadthScoreChange: null, divergenceSignal: null, topSectors: [],
    },
  };

  const data: WeeklyReportData = {
    indexReturns: indices as WeeklyReportData["indexReturns"],
    fearGreed: (indexData.fearGreed ?? null) as WeeklyReportData["fearGreed"],
    marketBreadth: breadthData.error
      ? EMPTY_BREADTH
      : {
          weeklyTrend: Array.isArray(breadthData.weeklyTrend) ? breadthData.weeklyTrend : [],
          phase1to2Transitions: Number(breadthData.phase1to2Transitions ?? 0),
          latestSnapshot: (breadthData.latestSnapshot ?? EMPTY_BREADTH.latestSnapshot) as MarketBreadthData["latestSnapshot"],
        },
    sectorRanking: (Array.isArray(sectorData.sectors) ? sectorData.sectors : []) as WeeklyReportData["sectorRanking"],
    industryTop10: allIndustries as WeeklyReportData["industryTop10"],
    watchlist: {
      summary: (watchlistData.summary ?? { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 }) as WeeklyReportData["watchlist"]["summary"],
      items: Array.isArray(watchlistData.items) ? watchlistData.items : [],
    },
    gate5Candidates: stocks as WeeklyReportData["gate5Candidates"],
    watchlistChanges: {
      registered: [],
      exited: [],
      pending4of5,
    },
    thesisAlignedCandidates: thesisAlignedRaw, // 인증 후 덮어씀
    vcpCandidates: vcpRaw != null ? (parse(vcpRaw).candidates as WeeklyReportData["vcpCandidates"]) ?? null : null,
    confirmedBreakouts: breakoutRaw != null ? (parse(breakoutRaw).breakouts as WeeklyReportData["confirmedBreakouts"]) ?? null : null,
    sectorLagPatterns: lagRaw != null ? (parse(lagRaw).patterns as WeeklyReportData["sectorLagPatterns"]) ?? null : null,
  };

  // ─── Thesis-Aligned LLM 인증 ─────────────────────────────────────────────
  if (thesisAlignedRaw != null && thesisAlignedRaw.chains.length > 0) {
    try {
      const beforeCount = thesisAlignedRaw.totalCandidates;
      const certified = await certifyThesisAlignedCandidates(thesisAlignedRaw);
      data.thesisAlignedCandidates = certified;
      logger.info(
        "CertifyTA",
        `인증 완료: ${beforeCount}개 후보 → ${certified.totalCandidates}개 인증`,
      );
    } catch (err) {
      logger.warn(
        "CertifyTA",
        `인증 실패 (미인증 데이터 사용): ${err instanceof Error ? err.message : String(err)}`,
      );
      // graceful degradation: 원본 데이터 유지
    }
  }

  const taLabel = thesisAlignedRaw != null
    ? `서사수혜: 체인 ${data.thesisAlignedCandidates?.chains.length ?? 0}, 후보 ${data.thesisAlignedCandidates?.totalCandidates ?? 0}`
    : "서사수혜: 수집 실패";
  const vcpCount = data.vcpCandidates?.length ?? 0;
  const breakoutCount = data.confirmedBreakouts?.length ?? 0;
  const lagCount = data.sectorLagPatterns?.length ?? 0;
  logger.info("Data", `지수 ${data.indexReturns.length} | 섹터 ${data.sectorRanking.length} | 업종 ${allIndustries.length} | Gate5 ${stocks.length} | 예비 ${pending4of5.length} | VCP ${vcpCount} | 돌파 ${breakoutCount} | 래그 ${lagCount} | ${taLabel}`);

  return data;
}

// ─── LLM 인사이트 생성 ─────────────────────────────────────────────────────

function buildInsightPrompt(data: WeeklyReportData, systemPrompt: string): { system: string; user: string } {
  // 데이터 요약을 user message에 주입
  const dataSummary = `
아래는 이번 주 수집된 시장 데이터입니다. 이 데이터를 기반으로 해석을 작성하세요.

## 지수 수익률
${data.indexReturns.map((i) => `${i.name}: ${i.weekEndClose} (${i.weeklyChangePercent >= 0 ? "+" : ""}${i.weeklyChangePercent.toFixed(2)}%)`).join("\n")}
${data.fearGreed != null ? `Fear & Greed: ${data.fearGreed.score} (${data.fearGreed.rating})` : ""}

## Phase 2 비율
${data.marketBreadth.weeklyTrend.map((t) => `${t.date}: ${t.phase2Ratio.toFixed(1)}%`).join(" → ")}
Phase 분포: P1 ${data.marketBreadth.latestSnapshot.phaseDistribution.phase1} / P2 ${data.marketBreadth.latestSnapshot.phaseDistribution.phase2} / P3 ${data.marketBreadth.latestSnapshot.phaseDistribution.phase3} / P4 ${data.marketBreadth.latestSnapshot.phaseDistribution.phase4}

## 섹터 로테이션 (11개)
${data.sectorRanking.map((s) => `${s.rsRank}. ${s.sector}: RS ${s.avgRs.toFixed(1)} (${s.rsChange != null && s.rsChange >= 0 ? "+" : ""}${s.rsChange?.toFixed(1) ?? "—"}) Phase ${s.groupPhase} P2비율 ${s.phase2Ratio.toFixed(1)}%`).join("\n")}

## 업종 RS Top 10
${data.industryTop10.slice(0, 10).map((i, idx) => `${idx + 1}. ${i.industry} (${i.sector}): RS ${i.avgRs.toFixed(1)} 주간변화 ${i.changeWeek != null ? (i.changeWeek >= 0 ? "+" : "") + i.changeWeek.toFixed(1) : "—"}`).join("\n")}

## 관심종목
ACTIVE: ${data.watchlist.summary.totalActive}개
${data.watchlist.items.map((w) => `${w.symbol}: Phase ${w.currentPhase ?? w.entryPhase}, RS ${w.currentRsScore ?? w.entryRsScore ?? "—"}, P&L ${w.pnlPercent?.toFixed(1) ?? "—"}%`).join("\n") || "없음"}

## 예비 관심종목 (4/5 통과, thesis 미충족)
${data.watchlistChanges.pending4of5.map((p) => `${p.symbol}: ${p.reason}`).join("\n") || "없음"}

## VCP 후보 (변동성 수축 패턴)
${data.vcpCandidates != null && data.vcpCandidates.length > 0
  ? data.vcpCandidates.slice(0, 15).map((v) => `${v.symbol}: BB폭 ${v.bbWidthCurrent?.toFixed(3) ?? "—"}, ATR% ${v.atr14Percent?.toFixed(2) ?? "—"}, Phase ${v.phase ?? "—"}, RS ${v.rsScore ?? "—"} (${v.sector ?? "—"})`).join("\n")
  : "없음"}

## 확인된 돌파 종목
${data.confirmedBreakouts != null && data.confirmedBreakouts.length > 0
  ? data.confirmedBreakouts.slice(0, 15).map((b) => `${b.symbol}: 돌파 ${b.breakoutPercent?.toFixed(1) ?? "—"}%, 거래량비율 ${b.volumeRatio?.toFixed(1) ?? "—"}x${b.isPerfectRetest ? " (완벽되돌림)" : ""}, Phase ${b.phase ?? "—"}, RS ${b.rsScore ?? "—"} (${b.sector ?? "—"})`).join("\n")
  : "없음"}

## 섹터 래그 패턴 (Phase 1→2)
${data.sectorLagPatterns != null && data.sectorLagPatterns.length > 0
  ? data.sectorLagPatterns.slice(0, 10).map((l) => `${l.leaderEntity} → ${l.followerEntity}: 평균 ${l.avgLagDays?.toFixed(1) ?? "—"}일 (n=${l.sampleCount}, p=${l.pValue?.toFixed(3) ?? "—"})`).join("\n")
  : "없음"}

---

위 데이터를 분석하여 아래 JSON으로 응답하세요.

## 작성 규칙 (반드시 준수)
- **간결하게.** 각 필드 2~3문장 이내. 장황한 설명 금지.
- 판단과 근거만 쓴다. 데이터 나열/반복하지 않는다 (데이터는 이미 테이블로 보여줌).
- 정보가 없거나 할 말이 없으면 "해당 없음" 한 줄. 억지로 늘리지 않는다.
- 숫자를 인용할 때는 위 데이터에 있는 정확한 값만 사용한다. 추정/반올림 금지.
- 반드시 유효한 JSON만 출력. 다른 텍스트를 앞뒤에 붙이지 마라.

{
  "marketTemperature": "bullish | neutral | bearish",
  "marketTemperatureLabel": "한 줄. 예: '약세 — EARLY_BEAR 지속'",
  "sectorRotationNarrative": "2~3문장. 구조적 상승 vs 일회성 반등 판단 + 핵심 근거 1개.",
  "industryFlowNarrative": "2~3문장. Top 10 업종의 공통 테마 또는 자금 집중 방향.",
  "watchlistNarrative": "1~2문장. ACTIVE 종목의 서사 유효성. 없으면 '해당 없음'.",
  "gate5Summary": "1~2문장. 등록/해제 판단 요약. 없으면 '이번 주 신규 등록/해제 없음'.",
  "riskFactors": "핵심 리스크 2~3개. 각 1문장.",
  "nextWeekWatchpoints": "확인할 시그널 2~3개. 각 1문장.",
  "thesisScenarios": "ACTIVE thesis별 다음 주 확인 포인트. 각 1문장.",
  "debateInsight": "2~3문장. thesis 간 충돌/강화 핵심만.",
  "narrativeEvolution": "2~3문장. 서사 체인 변화 핵심만. 변화 없으면 '유의미한 변화 없음'.",
  "thesisAccuracy": "1~2문장. 최근 적중/실패 사례 1개씩.",
  "regimeContext": "1~2문장. 현재 레짐과 전략 포지셔닝.",
  "discordMessage": "3~5줄. 지수 변화 + Phase2 비율 + 등록/해제 건수."
}`;

  return { system: systemPrompt, user: dataSummary };
}

async function generateInsight(
  data: WeeklyReportData,
  systemPrompt: string,
): Promise<WeeklyReportInsight> {
  logger.step("[5/7] Generating insight via Claude CLI...");

  const cli = new ClaudeCliProvider("claude-sonnet-4-6", 600_000); // 10분 타임아웃
  const { system, user } = buildInsightPrompt(data, systemPrompt);

  try {
    const result = await cli.call({ systemPrompt: system, userMessage: user });
    logger.info("CLI", `Tokens: ${result.tokensUsed.input} input / ${result.tokensUsed.output} output`);

    // JSON 파싱
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
  } finally {
    cli.dispose();
  }
}

// ─── 발행 ───────────────────────────────────────────────────────────────────

async function publishWeeklyReport(
  html: string,
  insight: WeeklyReportInsight,
  targetDate: string,
): Promise<void> {
  const storageUrl = await (async (): Promise<string | null> => {
    try {
      return await publishHtmlReport(html, targetDate, "weekly");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("Publish", `HTML 업로드 실패 — Discord 메시지만 발송: ${reason}`);
      return null;
    }
  })();

  const discordText = storageUrl != null
    ? `${insight.discordMessage}\n\n📊 상세 리포트: ${storageUrl}`
    : insight.discordMessage;

  await sendDiscordMessage(discordText, "DISCORD_WEEKLY_WEBHOOK_URL");
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

async function main() {
  logger.step("=== Weekly Market Analysis (CLI Mode) ===\n");

  // 1. 환경변수 검증
  validateEnvironment();
  logger.step("[1/7] Environment validated");

  // 2. 최신 거래일 확인
  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.step("No trade date found. Skipping.");
    await sendDiscordMessage("📊 거래 데이터가 없습니다.", "DISCORD_WEEKLY_WEBHOOK_URL");
    await pool.end();
    return;
  }
  logger.step(`[2/7] Target date: ${targetDate}`);

  // 3. 컨텍스트 로딩
  logger.step("[3/7] Loading contexts...");

  let fundamentalSupplement = "";
  try {
    const validationResult = await runFundamentalValidation();
    fundamentalSupplement = formatFundamentalSupplement(validationResult.scores, { includeHeader: false });
    logger.info("Fundamental", `${validationResult.scores.length}개 종목 검증 완료`);
  } catch (err) {
    logger.error("Fundamental", `검증 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  let thesesContext = "";
  try {
    const activeTheses = await loadActiveTheses();
    thesesContext = formatThesesForPrompt(activeTheses);
    if (activeTheses.length > 0) logger.info("Theses", `${activeTheses.length}개 ACTIVE thesis`);
  } catch (err) {
    logger.error("Theses", `실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  let narrativeChainsSummary = "";
  try {
    narrativeChainsSummary = await formatChainsSummaryForPrompt();
  } catch (err) {
    logger.error("NarrativeChain", `실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  let sectorLagContext = "";
  try {
    sectorLagContext = await formatLeadingSectorsForPrompt(targetDate);
  } catch (err) {
    logger.error("SectorLag", `실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  let sectorClusterContext = "";
  try {
    sectorClusterContext = await loadSectorClusterContext(targetDate);
  } catch (err) {
    logger.warn("SectorCluster", `실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  let regimeContext = "";
  try {
    const [recentRegimes, pendingRegimes] = await Promise.all([
      loadRecentRegimes(30),
      loadPendingRegimes(),
    ]);
    regimeContext = formatRegimeForPrompt(recentRegimes, pendingRegimes);
  } catch (err) {
    logger.error("Regime", `실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  const signalPerformance = loadSignalPerformanceSummary();

  let watchlistContext = "";
  try {
    const watchlistRaw = await getWatchlistStatus.execute({ include_trajectory: false });
    const wd = JSON.parse(watchlistRaw) as { summary?: { totalActive: number; phaseChanges: unknown[] } };
    const totalActive = wd.summary?.totalActive ?? 0;
    if (totalActive > 0) {
      watchlistContext = `현재 ACTIVE 관심종목 ${totalActive}개 추적 중`;
    }
  } catch {
    // fail-open
  }

  const systemPrompt = buildWeeklySystemPrompt({
    fundamentalSupplement,
    thesesContext,
    signalPerformance,
    narrativeChainsSummary,
    sectorLagContext,
    regimeContext,
    watchlistContext,
    sectorClusterContext,
  });

  // 4. 데이터 수집 (도구 직접 호출 — LLM 불필요)
  const data = await collectWeeklyData(targetDate);

  // 5. LLM 인사이트 생성 (CLI 단발 호출)
  const insight = await generateInsight(data, systemPrompt);

  // 6. HTML 조립 + 발행
  logger.step("[6/7] Building and publishing report...");
  const html = buildWeeklyHtml(data, insight, targetDate);

  // 로컬 프리뷰 저장 (항상)
  const { writeFileSync } = await import("fs");
  writeFileSync("preview-weekly-new.html", html);
  logger.info("Preview", `preview-weekly-new.html (${(html.length / 1024).toFixed(1)} KB)`);

  await publishWeeklyReport(html, insight, targetDate);

  // DB 저장
  try {
    await saveReportLog({
      date: targetDate,
      type: "weekly",
      reportedSymbols: [],
      marketSummary: { phase2Ratio: 0, leadingSectors: [], totalAnalyzed: 0 },
      fullContent: null,
      metadata: {
        model: "claude-sonnet-4-6 (CLI)",
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        executionTime: 0,
      },
    });
    await updateReportFullContent(targetDate, "weekly", html);
  } catch (err) {
    logger.warn("DB", `리포트 저장 실패 (발행은 완료): ${err instanceof Error ? err.message : String(err)}`);
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
