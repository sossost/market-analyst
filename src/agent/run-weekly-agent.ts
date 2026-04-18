import "dotenv/config";
import { pool } from "@/db/client";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { buildWeeklySystemPrompt } from "./systemPrompt";
import { sendDiscordError, sendDiscordMessage } from "@/lib/discord";
import { logger } from "@/lib/logger";
import {
  getActivePortfolioPositions,
  getActivePortfolioPositionsWithCurrentData,
  insertPortfolioPosition,
  updatePortfolioExit,
} from "@/db/repositories/portfolioPositionsRepository";
import { findPortfolioEligibleStock } from "@/db/repositories/stockPhaseRepository";

// Tools — 데이터 수집용 직접 호출
import { getIndexReturns } from "@/tools/getIndexReturns";
import { getMarketBreadth } from "@/tools/getMarketBreadth";
import { getLeadingSectors } from "@/tools/getLeadingSectors";
import { getPhase2Stocks } from "@/tools/getPhase2Stocks";
import { getTrackedStocks } from "@/tools/getTrackedStocks";
import { getVCPCandidates } from "@/tools/getVCPCandidates";
import { getConfirmedBreakouts } from "@/tools/getConfirmedBreakouts";
import { getSectorLagPatterns } from "@/tools/getSectorLagPatterns";
import { buildThesisAlignedCandidates } from "@/lib/thesisAlignedCandidates";
import { certifyThesisAlignedCandidates } from "@/lib/certifyThesisAligned";
import { selectWeeklyWatchlist, WEEKLY_WATCHLIST_MAX } from "@/lib/watchlistSelection";

// Schema + Builder
import type {
  WeeklyReportData,
  WeeklyReportInsight,
  MarketBreadthData,
  IndustryItem,
  WatchlistChange,
} from "@/tools/schemas/weeklyReportSchema";
import type { ReportedStock } from "@/types";
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
  const [indexRaw, breadthRaw, sectorRaw, industryRaw, trackedStocksRaw, phase2Raw, allIndustryRaw, thesisAlignedRaw, vcpRaw, breakoutRaw, lagRaw, activePortfolio] =
    await Promise.all([
      getIndexReturns.execute({ mode: "weekly", date: targetDate }),
      getMarketBreadth.execute({ mode: "weekly", date: targetDate }),
      getLeadingSectors.execute({ mode: "weekly", date: targetDate }),
      getLeadingSectors.execute({ mode: "industry", limit: 10, date: targetDate }),
      getTrackedStocks.execute({ include_trajectory: true }),
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
      getActivePortfolioPositions().catch((err: unknown) => {
        logger.warn("Portfolio", `ACTIVE 포지션 조회 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }),
    ]);

  const indexData = parse(indexRaw);
  const breadthData = parse(breadthRaw);
  const sectorData = parse(sectorRaw);
  const industryData = parse(industryRaw);
  const trackedStocksData = parse(trackedStocksRaw);
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
      summary: (trackedStocksData.summary ?? { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 }) as WeeklyReportData["watchlist"]["summary"],
      items: Array.isArray(trackedStocksData.items) ? trackedStocksData.items : [],
    },
    gate5Candidates: stocks as WeeklyReportData["gate5Candidates"],
    watchlistChanges: {
      registered: [],
      exited: [],
    },
    activePortfolioSymbols: activePortfolio.map((p) => p.symbol),
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
  logger.info("Data", `지수 ${data.indexReturns.length} | 섹터 ${data.sectorRanking.length} | 업종 ${allIndustries.length} | Gate5 ${stocks.length} | 포트폴리오 ${activePortfolio.length}개 | VCP ${vcpCount} | 돌파 ${breakoutCount} | 래그 ${lagCount} | ${taLabel}`);

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

## 관심종목 — 이번 주 주목 (선별 기준: featured > Phase2 연속 > 포착 선행성)
${(() => {
  const portfolioExcluded = data.watchlist.items.filter(
    (w) => !data.activePortfolioSymbols.includes(w.symbol),
  );
  const scored = selectWeeklyWatchlist(portfolioExcluded);
  const topItems = scored.slice(0, WEEKLY_WATCHLIST_MAX);
  const remainCount = scored.length - topItems.length;

  const formatItem = (w: typeof topItems[0]) => {
    const p2Label = w.phase2Segment != null && w.phase2SinceDays != null
      ? ` [P2 ${w.phase2Segment} ${w.phase2SinceDays}일]` : "";
    const streak = w.recentPhase2Streak ?? 0;
    const lagStr = w.detectionLag != null ? `lag=${w.detectionLag}일` : "";
    const tierTag = w.tier === "featured" ? " ★featured" : "";
    return `${w.symbol}: Phase ${w.currentPhase ?? w.entryPhase}, RS ${w.currentRsScore ?? w.entryRsScore ?? "—"}, P&L ${w.pnlPercent?.toFixed(1) ?? "—"}%${p2Label}, P2연속 ${streak}일${lagStr ? `, ${lagStr}` : ""}${tierTag}`;
  };

  const header = `ACTIVE S/A: ${scored.length}개 (상위 ${topItems.length}개 표시${remainCount > 0 ? `, ${remainCount}개 생략` : ""})`;
  const lines = topItems.map(formatItem).join("\n") || "없음";
  return `${header}\n${lines}`;
})()}
※ 선별 기준: featured 티어 우선 → Phase 2 14일 연속 → detection_lag(포착 선행성) 짧은 순
※ P2 구간: 초입(1~5일)=최고 주목, 진행(6~20일)=추세 확인, 확립(21일+)=이미 진행 중
※ 주봉 관점: Phase 2 연속일이 길수록 주봉 관점에서도 안정적. P2연속 14일+=주봉 3주 이상 유지.
※ 지시: 위 종목 중 이번 주 특히 주목할 Top 5~7을 선별하여 watchlistNarrative에 서술하라. 나머지는 간략 언급 또는 생략.
※ 포트폴리오 편입 종목은 이미 제외되어 있음.

## 현재 포트폴리오 (portfolio_positions ACTIVE)
${data.activePortfolioSymbols.length === 0
  ? "현재 편입 종목 없음 — 이번 주 신규 편입만 판단"
  : data.activePortfolioSymbols.map((sym) => `${sym}: ACTIVE`).join("\n")
}

## 포트폴리오 심사 기준

**편입 조건 (모두 충족)**:
1. gate5Candidates 목록에 존재 (etl_auto 전체 게이트 통과 확인)
2. SEPA S 또는 A 등급 필수
3. 이번 주 최대 5개 편입

**탈락 조건 (1개라도 해당)**:
- Phase 3 이상 진입
- RS 30 미만
- 서사(thesis) 완전 소멸 + RS 약세 동반

**주의 사항**:
- entry_price는 시스템이 자동 조회하므로 portfolioRegistrations에 포함하지 않는다
- portfolioExits의 entry_date는 위 "현재 포트폴리오" 목록에서 그대로 복사한다
- 편입/탈락이 없으면 portfolioRegistrations: [], portfolioExits: [] 빈 배열로 출력

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
  "gate5Summary": "1~2문장. 포트폴리오 편입/탈락 판단 근거 요약. 없으면 '이번 주 포트폴리오 변동 없음'.",
  "riskFactors": "핵심 리스크 2~3개. 각 1문장.",
  "nextWeekWatchpoints": "확인할 시그널 2~3개. 각 1문장.",
  "thesisScenarios": "ACTIVE thesis별 다음 주 확인 포인트. 각 1문장.",
  "debateInsight": "2~3문장. thesis 간 충돌/강화 핵심만.",
  "narrativeEvolution": "2~3문장. 서사 체인 변화 핵심만. 변화 없으면 '유의미한 변화 없음'.",
  "thesisAccuracy": "1~2문장. 최근 적중/실패 사례 1개씩.",
  "regimeContext": "1~2문장. 현재 레짐과 전략 포지셔닝.",
  "discordMessage": "3~5줄. 지수 변화 + Phase2 비율 + 포트폴리오 변동 건수.",
  "portfolioRegistrations": [
    {
      "symbol": "NVDA",
      "phase": 2,
      "rs_score": 95,
      "sector": "Technology",
      "industry": "Semiconductors",
      "reason": "AI 인프라 수요 + Phase 2 초입 + SEPA S",
      "tier": "featured",
      "sepa_grade": "S"
    }
  ],
  "portfolioExits": [
    {
      "symbol": "AAPL",
      "entry_date": "2026-01-15",
      "exit_reason": "Phase 3 전환 — 분산 징후"
    }
  ]
}`;

  return { system: systemPrompt, user: dataSummary };
}

interface InsightResult {
  insight: WeeklyReportInsight;
  tokensUsed: { input: number; output: number };
  executionTimeMs: number;
}

async function generateInsight(
  data: WeeklyReportData,
  systemPrompt: string,
): Promise<InsightResult> {
  logger.step("[5/7] Generating insight via Claude CLI...");

  const cli = new ClaudeCliProvider("claude-sonnet-4-6", 600_000); // 10분 타임아웃
  const { system, user } = buildInsightPrompt(data, systemPrompt);
  const startMs = Date.now();

  try {
    const result = await cli.call({ systemPrompt: system, userMessage: user });
    const executionTimeMs = Date.now() - startMs;
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
      return {
        insight: fillInsightDefaults({}),
        tokensUsed: result.tokensUsed,
        executionTimeMs,
      };
    }

    return {
      insight: fillInsightDefaults(parsed),
      tokensUsed: result.tokensUsed,
      executionTimeMs,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("CLI", `LLM 호출 실패: ${reason}`);
    return {
      insight: fillInsightDefaults({}),
      tokensUsed: { input: 0, output: 0 },
      executionTimeMs: Date.now() - startMs,
    };
  } finally {
    cli.dispose();
  }
}

// ─── 포트폴리오 승격/탈락 처리 ──────────────────────────────────────────────

interface PortfolioDelta {
  registered: WatchlistChange[];
  exited: WatchlistChange[];
}

/**
 * LLM 인사이트의 포트폴리오 편입/탈락 판단을 실제 DB에 반영한다.
 * DB 직접 조회로 편입 자격 검증 (Phase 2 + RS>=60 + SEPA S/A).
 * gate5Candidates LIMIT 200 종속 없이 명시적 조건으로 판단한다.
 * 탈락 처리는 fail-open — 실패 시 로그 후 계속 진행.
 */
async function evaluatePortfolio(
  insight: WeeklyReportInsight,
  targetDate: string,
): Promise<PortfolioDelta> {
  const registered: WatchlistChange[] = [];
  const exited: WatchlistChange[] = [];

  // 1. 승격 처리 — 독립 DB 조회로 편입 자격 검증 (gate5Candidates LIMIT 200 종속 제거)
  for (const item of insight.portfolioRegistrations ?? []) {
    const eligible = await findPortfolioEligibleStock(item.symbol, targetDate);

    if (eligible == null) {
      logger.warn(
        "Portfolio",
        `${item.symbol} 편입 자격 미충족 (Phase 2 + RS>=60 + SEPA S/A 동시 충족 필요) — 승격 거부`,
      );
      continue;
    }

    const id = await insertPortfolioPosition({
      symbol: item.symbol,
      sector: item.sector ?? eligible.sector ?? undefined,
      industry: item.industry ?? eligible.industry ?? undefined,
      entryDate: targetDate,
      // entryPrice 생략 → Repository 내부에서 daily_prices 자동 조회
      entryPhase: item.phase,
      entryRsScore: item.rs_score ?? eligible.rs_score ?? undefined,
      entrySepaGrade: item.sepa_grade ?? eligible.sepa_grade ?? undefined,
      thesisId: item.thesis_id ?? undefined,
      tier: item.tier,
    });

    if (id != null) {
      registered.push({ symbol: item.symbol, action: "register", reason: item.reason });
      logger.info("Portfolio", `${item.symbol} 편입 완료 (id=${id})`);
    } else {
      logger.info("Portfolio", `${item.symbol} 이미 편입 (중복 무시)`);
    }
  }

  // 2. 탈락 처리 — ACTIVE 포지션 특정 후 EXITED 전환 (fail-open)
  for (const item of insight.portfolioExits ?? []) {
    try {
      await updatePortfolioExit(item.symbol, item.entry_date, {
        exitDate: targetDate,
        exitReason: item.exit_reason,
        // exitPrice 생략 → null로 저장 (허용)
      });
      exited.push({ symbol: item.symbol, action: "exit", reason: item.exit_reason });
      logger.info("Portfolio", `${item.symbol} 탈락 처리 완료`);
    } catch (err) {
      logger.warn(
        "Portfolio",
        `${item.symbol} 탈락 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      // fail-open: 계속 진행
    }
  }

  return { registered, exited };
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

// ─── reportedSymbols 수집 ──────────────────────────────────────────────────

/**
 * 주간 리포트 데이터에서 분석된 종목을 수집하여 ReportedStock[] 형태로 반환한다.
 * 일간 리포트(run-daily-agent.ts)의 reportedSymbols 구조와 동일.
 */
export function buildWeeklyReportedSymbols(
  data: WeeklyReportData,
  targetDate: string,
): ReportedStock[] {
  // thesis_aligned 후보: SEPA S/A (4/4 게이트 충족) 종목만 — 일간 리포트와 동일 기준
  const thesisAlignedSymbols = new Map<string, { phase: number; rsScore: number; sector: string; industry: string }>();
  if (data.thesisAlignedCandidates != null) {
    for (const chain of data.thesisAlignedCandidates.chains) {
      for (const c of chain.candidates) {
        if (c.gatePassCount !== c.gateTotalCount) {
          continue;
        }
        if (!thesisAlignedSymbols.has(c.symbol)) {
          thesisAlignedSymbols.set(c.symbol, {
            phase: c.phase ?? 0,
            rsScore: c.rsScore ?? 0,
            sector: c.sector ?? "",
            industry: c.industry ?? "",
          });
        }
      }
    }
  }

  // 각 소스에서 심볼을 수집하고 중복 제거 (우선순위: gate5 > breakout > vcp > thesisAligned > watchlist)
  const symbolSet = new Set<string>();

  const gate5Symbols = data.gate5Candidates.map((s) => s.symbol);
  const breakoutSymbols = (data.confirmedBreakouts ?? []).map((s) => s.symbol);
  const vcpSymbols = (data.vcpCandidates ?? []).map((s) => s.symbol);
  const watchlistSymbols = data.watchlist.items.map((w) => w.symbol);

  for (const s of [...gate5Symbols, ...breakoutSymbols, ...vcpSymbols, ...thesisAlignedSymbols.keys(), ...watchlistSymbols]) {
    symbolSet.add(s);
  }

  const gate5Map = new Map(data.gate5Candidates.map((s) => [s.symbol, s]));

  return Array.from(symbolSet).map((symbol) => {
    const gate5 = gate5Map.get(symbol) ?? null;
    const breakout = (data.confirmedBreakouts ?? []).find((s) => s.symbol === symbol);
    const vcp = (data.vcpCandidates ?? []).find((s) => s.symbol === symbol);
    const ta = thesisAlignedSymbols.get(symbol);
    const watchItem = data.watchlist.items.find((w) => w.symbol === symbol);

    const phase = gate5?.phase ?? breakout?.phase ?? vcp?.phase ?? ta?.phase ?? watchItem?.currentPhase ?? watchItem?.entryPhase ?? 0;
    const rsScore = gate5?.rsScore ?? breakout?.rsScore ?? vcp?.rsScore ?? ta?.rsScore ?? watchItem?.currentRsScore ?? watchItem?.entryRsScore ?? 0;
    const sector = gate5?.sector ?? breakout?.sector ?? vcp?.sector ?? ta?.sector ?? watchItem?.entrySector ?? "";
    const industry = gate5?.industry ?? breakout?.industry ?? vcp?.industry ?? ta?.industry ?? watchItem?.entryIndustry ?? "";

    // reason: 가장 의미 있는 소스 우선
    const reason =
      gate5 != null ? "5중게이트"
      : breakout != null ? "돌파확인"
      : vcp != null ? "VCP"
      : ta != null ? "서사수혜"
      : watchItem != null ? "관심종목"
      : "기타";

    return {
      symbol,
      phase,
      prevPhase: gate5?.prevPhase ?? null,
      rsScore,
      sector,
      industry,
      reason,
      firstReportedDate: targetDate,
    };
  });
}

// ─── reportedSymbols 소스 진단 ────────────────────────────────────────────

export interface WeeklySourceCounts {
  gate5: number;
  breakout: number;
  vcp: number;
  thesisAligned: number;
  watchlist: number;
  portfolio: number;
}

/**
 * 주간 리포트 데이터에서 소스별 종목 건수를 집계한다.
 * thesisAligned는 buildWeeklyReportedSymbols와 동일 기준(4/4 게이트 충족)으로 카운트.
 */
export function getWeeklySourceCounts(data: WeeklyReportData): WeeklySourceCounts {
  const thesisAlignedSymbols = new Set<string>();
  if (data.thesisAlignedCandidates != null) {
    for (const chain of data.thesisAlignedCandidates.chains) {
      for (const c of chain.candidates) {
        if (c.gatePassCount === c.gateTotalCount) {
          thesisAlignedSymbols.add(c.symbol);
        }
      }
    }
  }

  return {
    gate5: data.gate5Candidates.length,
    breakout: (data.confirmedBreakouts ?? []).length,
    vcp: (data.vcpCandidates ?? []).length,
    thesisAligned: thesisAlignedSymbols.size,
    watchlist: data.watchlist.items.length,
    portfolio: data.activePortfolioSymbols.length,
  };
}

export function formatSourceCounts(counts: WeeklySourceCounts): string {
  return `Gate5 ${counts.gate5}, 돌파 ${counts.breakout}, VCP ${counts.vcp}, 서사수혜 ${counts.thesisAligned}, 관심종목 ${counts.watchlist}, 포트폴리오 ${counts.portfolio}`;
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

  let trackedStocksContext = "";
  try {
    const trackedRaw = await getTrackedStocks.execute({ include_trajectory: false });
    const td = JSON.parse(trackedRaw) as { summary?: { totalActive: number; phaseChanges: unknown[] } };
    const totalActive = td.summary?.totalActive ?? 0;
    if (totalActive > 0) {
      trackedStocksContext = `현재 ACTIVE 추적 종목 ${totalActive}개 추적 중`;
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
    watchlistContext: trackedStocksContext,
    sectorClusterContext,
  });

  // 4. 데이터 수집 (도구 직접 호출 — LLM 불필요)
  let data = await collectWeeklyData(targetDate);

  // 5. LLM 인사이트 생성 (CLI 단발 호출)
  const { insight, tokensUsed, executionTimeMs } = await generateInsight(data, systemPrompt);

  // 5.5. 포트폴리오 승격/탈락 처리 (LLM 판단 → DB 반영)
  const portfolioDelta = await evaluatePortfolio(insight, targetDate);
  data = {
    ...data,
    watchlistChanges: {
      ...data.watchlistChanges,
      registered: [...data.watchlistChanges.registered, ...portfolioDelta.registered],
      exited: [...data.watchlistChanges.exited, ...portfolioDelta.exited],
    },
  };

  // 6. HTML 조립 + 발행
  logger.step("[6/7] Building and publishing report...");
  const portfolioWithCurrentData = await getActivePortfolioPositionsWithCurrentData(targetDate).catch(
    (err: unknown) => {
      logger.warn(
        "Portfolio",
        `현재 포트폴리오 데이터 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    },
  );
  const html = buildWeeklyHtml(data, insight, targetDate, portfolioWithCurrentData);

  // 로컬 프리뷰 저장 (항상)
  const { writeFileSync } = await import("fs");
  writeFileSync("preview-weekly-new.html", html);
  logger.info("Preview", `preview-weekly-new.html (${(html.length / 1024).toFixed(1)} KB)`);

  await publishWeeklyReport(html, insight, targetDate);

  // DB 저장
  const reportedSymbols = buildWeeklyReportedSymbols(data, targetDate);

  // 소스별 건수 진단 로그
  const sourceCounts = getWeeklySourceCounts(data);
  logger.info(
    "ReportedSymbols",
    `${reportedSymbols.length}건 수집 | ${formatSourceCounts(sourceCounts)}`,
  );

  if (reportedSymbols.length === 0) {
    logger.warn(
      "ReportedSymbols",
      `모든 소스 0건 — 빈 배열 저장. 소스: ${formatSourceCounts(sourceCounts)}`,
    );
    try {
      await sendDiscordMessage(
        `⚠️ 주간 리포트 reported_symbols 0건\n소스별: ${formatSourceCounts(sourceCounts)}\n빈 배열로 저장됩니다. 데이터 수집 단계를 확인하세요.`,
        "DISCORD_WEEKLY_WEBHOOK_URL",
      );
    } catch (err) {
      logger.warn(
        "Discord",
        `빈 소스 경고 알림 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const snapshot = data.marketBreadth.latestSnapshot;
  const dist = snapshot.phaseDistribution;
  try {
    await saveReportLog({
      date: targetDate,
      type: "weekly",
      reportedSymbols,
      marketSummary: {
        phase2Ratio: snapshot.phase2Ratio,
        leadingSectors: data.sectorRanking.slice(0, 3).map((s) => s.sector),
        totalAnalyzed: dist.phase1 + dist.phase2 + dist.phase3 + dist.phase4,
      },
      fullContent: null,
      metadata: {
        model: "claude-sonnet-4-6 (CLI)",
        tokensUsed,
        toolCalls: 0,
        executionTime: executionTimeMs,
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
