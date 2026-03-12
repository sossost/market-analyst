import "dotenv/config";
import { pool } from "@/db/client";
import { runDebate } from "./debate/debateEngine";
import { buildMemoryContext } from "./debate/memoryLoader";
import { loadMarketSnapshot, formatMarketSnapshot } from "./debate/marketDataLoader";
import { collectNews, formatNewsForPersona } from "./debate/newsCollector";
import { loadNewsForPersona } from "./debate/newsLoader";
import { saveTheses, expireStaleTheses, getThesisStats } from "./debate/thesisStore";
import { validateRegimeInput, saveRegime } from "./debate/regimeStore";
import { verifyTheses } from "./debate/thesisVerifier";
import { saveDebateSession, buildFewShotContext } from "./debate/sessionStore";
import { sendDiscordMessage, sendDiscordError, sendDiscordFile } from "./discord";
import { createGist } from "./gist";
import { logger } from "./logger";
import { loadFundamentalData } from "../lib/fundamental-data-loader";
import { scoreFundamentals, promoteTopToS } from "../lib/fundamental-scorer";
import { formatFundamentalContext } from "./debate/round3-synthesis";
import type { DebateResult, RoundOutput } from "../types/debate";
import type { MarketSnapshot } from "./debate/marketDataLoader";

interface AlertDecision {
  send: boolean;
  reason: string;
}

/**
 * 리포트 발송 조건 판정.
 * 매일 토론은 기억 축적이 목적 — 중요할 때만 알림.
 *
 * 발송 조건:
 * 1. high confidence thesis가 1개 이상
 * 2. 애널리스트 간 의견 크게 갈림 (consensus 2/4 이하가 과반)
 * 3. thesis가 3개 이상 (활발한 토론)
 */
function checkAlertConditions(result: DebateResult): AlertDecision {
  const { theses } = result.round3;

  if (theses.length === 0) {
    return { send: false, reason: "" };
  }

  const highConfidence = theses.filter((t) => t.confidence === "high");
  if (highConfidence.length > 0) {
    return { send: true, reason: `확신도 높은 전망 ${highConfidence.length}건` };
  }

  const lowConsensus = theses.filter(
    (t) => t.consensusLevel === "1/4" || t.consensusLevel === "2/4",
  );
  if (lowConsensus.length > theses.length / 2) {
    return { send: true, reason: `애널리스트 간 의견 분열 — 주의 필요` };
  }

  if (theses.length >= 3) {
    return { send: true, reason: `주요 전망 ${theses.length}건 도출` };
  }

  return { send: false, reason: "" };
}

/**
 * 리포트에서 "핵심 요약" 섹션을 추출하여 Discord 메시지에 포함.
 * 못 찾으면 리포트 첫 300자를 사용.
 */
function extractCoreInsight(report: string): string {
  // "## 1. 핵심 요약" ~ 다음 "##" 사이 추출
  const match = report.match(/##\s*1\.\s*핵심 요약[^\n]*\n([\s\S]*?)(?=\n##\s*2\.|\n##\s*\d)/);
  if (match != null) {
    return match[1].trim();
  }

  // fallback: 첫 300자
  const firstChunk = report.slice(0, 300).trim();
  return firstChunk.endsWith(".") ? firstChunk : `${firstChunk}...`;
}

const PERSONA_LABELS: Record<string, string> = {
  macro: "🏦 매크로",
  tech: "📊 테크",
  geopolitics: "🌍 지정학",
  sentiment: "🧠 심리",
};

/**
 * 각 애널리스트의 Round 1 분석에서 핵심 인사이트(첫 의미 있는 문단)를 추출.
 */
function extractPersonaInsights(outputs: RoundOutput[]): string {
  return outputs
    .map((o) => {
      const label = PERSONA_LABELS[o.persona] ?? o.persona;
      const insight = extractFirstInsight(o.content);
      return `${label}: ${insight}`;
    })
    .join("\n");
}

/**
 * LLM 출력에서 첫 의미 있는 문단을 추출 (헤더/빈줄 건너뜀).
 * 150자 제한으로 간결하게.
 */
function extractFirstInsight(content: string): string {
  const MAX_LENGTH = 150;
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // 헤더, 빈줄, 구분선 건너뜀
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("---") || trimmed.startsWith("```")) {
      continue;
    }
    // 목록 항목이면 마커 제거
    const cleaned = trimmed.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "");
    if (cleaned.length < 10) continue;

    if (cleaned.length <= MAX_LENGTH) return cleaned;
    return `${cleaned.slice(0, MAX_LENGTH)}...`;
  }

  return content.slice(0, MAX_LENGTH).trim() + "...";
}

/**
 * Round 2 교차 토론에서 애널리스트 간 핵심 쟁점을 추출.
 */
function extractKeyDebatePoint(outputs: RoundOutput[]): string | null {
  // Round 2에서 "반박", "동의하지 않", "다른 시각", "우려" 등 충돌 키워드가 있는 문장 추출
  const CONFLICT_KEYWORDS = ["반박", "동의하지 않", "다른 시각", "우려", "과대평가", "간과", "위험", "리스크"];

  for (const output of outputs) {
    const lines = output.content.split("\n");
    for (const line of lines) {
      const cleaned = line.trim().replace(/^[-*•]\s*|^\d+\.\s*/, "");
      if (cleaned.length < 20) continue;
      const hasConflict = CONFLICT_KEYWORDS.some((kw) => cleaned.includes(kw));
      if (hasConflict) {
        const label = PERSONA_LABELS[output.persona] ?? output.persona;
        const point = cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned;
        return `${label}: ${point}`;
      }
    }
  }

  return null;
}

/**
 * Discord 멘션 sanitize — LLM 생성 텍스트에서 @everyone, @here 등 제거.
 */
function sanitizeDiscordMentions(text: string): string {
  return text
    .replace(/@everyone/gi, "@\u200Beveryone")
    .replace(/@here/gi, "@\u200Bhere")
    .replace(/<@[!&]?\d+>/g, "[mention]");
}

function buildDebateQuestion(debateDate: string): string {
  return `오늘은 ${debateDate}입니다.

우리의 목표는 **상승 초입(바닥을 돌파하여 본격 상승이 시작되는 구간)에 진입 중인 주도섹터와 주도주를 남들보다 먼저 포착**하는 것입니다.

## 분석 대상
아래에 **실제 시장 데이터**가 제공됩니다:
- 주요 지수 현재가 및 등락률
- 섹터별 RS(상대강도) 순위 및 Phase 상태
- 신규 상승 전환 진입 종목 (Phase 2 진입)
- RS 상위 종목
- 시장 브레드스 (Phase 분포)
- 공포탐욕지수, VIX

또한 당신의 전문 영역 관련 **최신 뉴스**가 별도로 제공됩니다.

## 필수 규칙
1. **제공된 데이터를 먼저 분석하라.** 데이터에 있는 종목, 섹터를 반드시 언급하라.
2. **제공된 데이터에 없는 가격/수치를 절대 지어내지 마라.** 모르면 "확인 불가"로 적어라.
3. **일반론 금지.** "유동성 확대는 위험자산에 유리" 같은 교과서적 문장은 가치 없다.
4. **모멘텀 방향을 확인하라.** RS가 높아도 5일/20일 가격 변화가 마이너스면 고점 피로감이다. 단순히 "RS 높으니 좋다"로 끝내지 마라.
5. **미래 변화를 전망하라.** 현재 상태 묘사에 그치지 말고, 향후 1~3개월 어떤 변화가 올지 분석하라.
6. 종목/ETF 언급 시 **반드시 티커** 사용 (예: NVDA, XLK)
7. 반드시 **한국어로** 작성하세요
8. 시스템 프롬프트에 정의된 **출력 형식**을 반드시 따르세요

## 병목 생애주기 판단 (필수)

당신의 전문 영역에서 현재 주요 병목에 대해 다음을 명시적으로 판단하라:

1. **현재 병목 상태**: 아래 중 하나로 분류
   - ACTIVE: 병목 진행 중. 수혜주 상승 구간.
   - RESOLVING: 병목 해소 진행 중. 다음 신호 감지 시작.
     신호 예시: 대규모 CAPEX 발표, 경쟁사 진입, 신규 공장 착공, 리드타임 단축 뉴스
   - RESOLVED: 공급 충족. 수혜주 모멘텀 둔화 시작.
   - OVERSUPPLY: 공급 과잉. 수혜주 하락 위험.

2. **RESOLVING/OVERSUPPLY 신호**: 다음 중 하나라도 해당하면 주의 표기
   - 동일 분야 CAPEX 발표가 최근 3개월간 3건 이상
   - 과거에 없던 경쟁사 진입 발표
   - 신규 공장 착공 또는 증설 발표
   - 리드타임 단축 또는 재고 증가 뉴스

3. **N+1 병목 예측**: 현재 병목이 해소된다면 공급 체인의 다음 제약 지점은 어디인가?
   예시: GPU 병목 해소 → 다음 제약은 HBM인가, 광트랜시버인가, 데이터센터 전력인가?
   확신이 없으면 "불명확"으로 표기. 억지로 예측하지 말 것.`;
}

async function loadFundamentalContextSafely(
  snapshot: MarketSnapshot,
): Promise<string> {
  const phase2Symbols = [
    ...snapshot.newPhase2Stocks.map((s) => s.symbol),
    ...snapshot.topPhase2Stocks.map((s) => s.symbol),
  ];
  const uniqueSymbols = [...new Set(phase2Symbols)];

  if (uniqueSymbols.length === 0) {
    logger.info("Fundamental", "No Phase 2 symbols to score");
    return "";
  }

  try {
    const fundamentalInputs = await loadFundamentalData(uniqueSymbols);
    const rawScores = fundamentalInputs.map((input) => scoreFundamentals(input));
    const scores = promoteTopToS(rawScores);
    logger.info(
      "Fundamental",
      `${uniqueSymbols.length} symbols scored — ${scores.filter((s) => s.grade === "S" || s.grade === "A").length} A/S grade`,
    );
    return formatFundamentalContext(scores);
  } catch (err) {
    logger.warn(
      "Fundamental",
      `펀더멘탈 데이터 로드 실패 (토론 계속 진행): ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

function validateEnvironment(): void {
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function getDebateDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  logger.step("=== Debate Agent: Daily Cabinet Discussion ===\n");

  // 1. 환경변수 검증
  validateEnvironment();
  logger.step("[1/9] Environment validated");

  // 2. 장기 기억 + 시장 데이터 로드
  const debateDate = getDebateDate();
  logger.step("[2/9] Loading memory context & market data...");

  const [memoryContext, marketSnapshot] = await Promise.all([
    buildMemoryContext(),
    loadMarketSnapshot(debateDate),
  ]);

  if (memoryContext.length > 0) {
    logger.info("Memory", `Loaded ${memoryContext.length} chars of memory context`);
  } else {
    logger.info("Memory", "No prior learnings — starting fresh");
  }

  const marketDataContext = formatMarketSnapshot(marketSnapshot);
  logger.info("MarketData", `Loaded ${marketDataContext.length} chars (${marketSnapshot.sectors.length} sectors, ${marketSnapshot.newPhase2Stocks.length} new Phase 2, ${marketSnapshot.indices.length} indices)`);

  // Phase 2 종목 심볼 추출 → 펀더멘탈 데이터 로드
  const fundamentalContext = await loadFundamentalContextSafely(marketSnapshot);

  // 2.5. 만료 thesis 정리
  const expiredCount = await expireStaleTheses(debateDate);
  if (expiredCount > 0) {
    logger.info("Thesis", `${expiredCount}개 thesis 만료 처리`);
  }
  const stats = await getThesisStats();
  logger.info("Thesis", `현재 상태: ${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  // 3. 기존 thesis 검증 (시장 데이터 기반)
  logger.step("[3/9] Verifying active theses...");
  try {
    const verifyResult = await verifyTheses(marketDataContext, debateDate, marketSnapshot);
    if (verifyResult.confirmed > 0 || verifyResult.invalidated > 0) {
      logger.info("Verify", `${verifyResult.confirmed} confirmed, ${verifyResult.invalidated} invalidated, ${verifyResult.held} held`);
    } else {
      logger.info("Verify", `${verifyResult.held} theses held (no changes)`);
    }
  } catch (err) {
    logger.warn("Verify", `Thesis verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. 뉴스 로드 (DB 우선, 폴백으로 실시간 수집)
  logger.step("[4/9] Loading news...");
  let newsContext: Record<string, string> = {};
  try {
    const personas = ["macro", "tech", "geopolitics", "sentiment"] as const;

    // DB에서 최근 뉴스 로드 시도
    for (const persona of personas) {
      const loaded = await loadNewsForPersona(persona);
      if (loaded.length > 0) {
        newsContext[persona] = loaded;
      }
    }

    const dbCount = Object.values(newsContext).filter((v) => v.length > 0).length;

    // DB에서 뉴스가 0건이면 기존 실시간 수집으로 폴백
    if (dbCount === 0) {
      logger.info("News", "DB 뉴스 0건 — 실시간 수집으로 폴백");
      const news = await collectNews();
      for (const persona of personas) {
        const formatted = formatNewsForPersona(persona, news);
        if (formatted.length > 0) {
          newsContext[persona] = formatted;
        }
      }
    }

    const totalItems = Object.values(newsContext).filter((v) => v.length > 0).length;
    logger.info("News", `${totalItems}/4 personas have news context`);
  } catch (err) {
    logger.warn("News", `News loading failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. 과거 유사 세션 로드 (few-shot)
  logger.step("[5/9] Loading similar past sessions...");
  let fewShotContext = "";
  try {
    fewShotContext = await buildFewShotContext(marketSnapshot);
    if (fewShotContext.length > 0) {
      logger.info("FewShot", `Loaded ${fewShotContext.length} chars of past session context`);
    } else {
      logger.info("FewShot", "No past sessions available yet");
    }
  } catch (err) {
    logger.warn("FewShot", `Failed to load past sessions: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Combine memory + few-shot into enriched memory context
  const enrichedMemory = [memoryContext, fewShotContext].filter((s) => s.length > 0).join("\n\n");

  // 6. 토론 실행
  logger.step(`[6/9] Running debate for ${debateDate}...`);

  const result = await runDebate({
    question: buildDebateQuestion(debateDate),
    debateDate,
    memoryContext: enrichedMemory,
    marketDataContext,
    newsContext,
    fundamentalContext,
  });

  logger.info("Debate", `Round 1: ${result.round1.outputs.length}/4 agents`);
  logger.info("Debate", `Round 2: ${result.round2.outputs.length} crossfire responses`);
  logger.info("Debate", `Round 3: ${result.round3.theses.length} theses extracted`);
  logger.info("Debate", `Tokens: ${result.metadata.totalTokens.input} in / ${result.metadata.totalTokens.output} out`);
  logger.info("Debate", `Duration: ${(result.metadata.totalDurationMs / 1000).toFixed(1)}s`);

  if (result.metadata.agentErrors.length > 0) {
    for (const err of result.metadata.agentErrors) {
      logger.warn("Debate", `Agent error: ${err.persona} (round ${err.round}): ${err.error}`);
    }
  }

  // 7. Thesis 저장 + 레짐 저장 + 세션 저장
  logger.step("[7/9] Saving theses, regime & session...");
  const savedCount = await saveTheses(debateDate, result.round3.theses);
  logger.info("Thesis", `${savedCount} theses saved to DB`);

  // 레짐 저장 (에러 격리 — 실패해도 토론 결과에 영향 없음)
  if (result.marketRegime != null) {
    try {
      const validated = validateRegimeInput(result.marketRegime);
      if (validated != null) {
        await saveRegime(debateDate, validated);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("Regime", `레짐 저장 실패 (토론은 계속): ${reason}`);
    }
  }

  try {
    await saveDebateSession({
      debateDate,
      marketDataContext,
      marketSnapshot,
      newsContext,
      result,
    });
  } catch (err) {
    logger.warn("Session", `Failed to save session: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 8. 조건부 Discord 발송
  logger.step("[8/9] Checking alert conditions...");
  const report = result.round3.report;
  const shouldAlert = checkAlertConditions(result);

  if (shouldAlert.send) {
    logger.info("Alert", `Sending report: ${shouldAlert.reason}`);

    // 핵심 요약 추출 (리포트 첫 섹션)
    const coreInsight = extractCoreInsight(report);

    // 애널리스트별 핵심 인사이트 (Round 1)
    const personaInsights = extractPersonaInsights(result.round1.outputs);

    // 애널리스트 간 쟁점 (Round 2)
    const debatePoint = extractKeyDebatePoint(result.round2.outputs);

    const thesesSummary = result.round3.theses
      .map((t) => {
        const confidence = t.confidence === "high" ? "🔴" : t.confidence === "medium" ? "🟡" : "⚪";
        const timeframe = `${t.timeframeDays}일`;
        return `${confidence} ${t.thesis} _(${timeframe}, ${t.consensusLevel} 합의)_`;
      })
      .join("\n");

    const sections = [
      `📊 **시황 브리핑** (${debateDate})`,
      "",
      coreInsight,
      "",
      "---",
      "",
      "**애널리스트 인사이트**",
      personaInsights,
    ];

    if (debatePoint != null) {
      sections.push("", "**핵심 쟁점**", debatePoint);
    }

    sections.push("", "---", "", "**검증 가능한 전망**", thesesSummary);

    const summary = sections.join("\n");

    const webhookVar = "DISCORD_DEBATE_WEBHOOK_URL";
    const webhookFallback = process.env[webhookVar] ?? process.env.DISCORD_WEBHOOK_URL;

    if (webhookFallback != null && webhookFallback !== "") {
      try {
        const gist = await createGist(
          `briefing-${debateDate}.md`,
          report,
          `시장 브리핑 ${debateDate}`,
        );
        const reportLink = gist != null ? `\n\n📄 전체 리포트: ${gist.url}` : "";
        await sendDiscordMessage(
          sanitizeDiscordMentions(`${summary}${reportLink}`),
          webhookVar,
        );
      } catch {
        await sendDiscordFile(
          webhookFallback,
          summary,
          `briefing-${debateDate}.md`,
          report,
        );
      }
    }
  } else {
    logger.info("Alert", "No alert conditions met — results saved to DB only");
  }

  await pool.end();
  logger.step("\nDone.");
}

main().catch(async (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error("Debate", `Fatal: ${errorMsg}`);
  await sendDiscordError(errorMsg);
  await pool.end();
  process.exit(1);
});
