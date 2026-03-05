import "dotenv/config";
import { pool } from "@/db/client";
import { runDebate } from "./debate/debateEngine";
import { buildMemoryContext } from "./debate/memoryLoader";
import { loadMarketSnapshot, formatMarketSnapshot } from "./debate/marketDataLoader";
import { saveTheses } from "./debate/thesisStore";
import { sendDiscordMessage, sendDiscordError, sendDiscordFile } from "./discord";
import { createGist } from "./gist";
import { logger } from "./logger";
import type { DebateResult } from "../types/debate";

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
 * 2. 장관 간 의견 크게 갈림 (consensus 2/4 이하가 과반)
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
    return { send: true, reason: `분석가 간 의견 분열 — 주의 필요` };
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

function buildDebateQuestion(debateDate: string): string {
  return `오늘은 ${debateDate}입니다.

우리의 목표는 **상승 초입(바닥을 돌파하여 본격 상승이 시작되는 구간)에 진입 중인 주도섹터와 주도주를 남들보다 먼저 포착**하는 것입니다.

최신 뉴스와 데이터를 반드시 검색하세요. 검색 결과의 날짜를 확인하고 ${debateDate} 기준 최신 데이터만 사용하세요.

## 분석 관점
1. 최근 시장의 구조적 변화 — 자금 흐름, 섹터 로테이션, 매크로 전환점
2. 지금 부상하고 있는 섹터/산업은 무엇이고, 왜 지금인가
3. 시장이 아직 충분히 반영하지 못한 구조적 테마
4. 현재 과열 신호가 보이거나 모멘텀이 꺾이는 섹터
5. 향후 1~3개월 내 검증 가능한 구체적 전망

## 필수 요구사항
- 아래에 **실제 시장 데이터**가 제공됩니다. 지수, 섹터 RS, Phase 2 종목 등은 이미 있으니 **같은 데이터를 검색하지 마세요.**
- 검색은 **뉴스, 이벤트, 촉매, 정책 변화** 등 제공된 데이터에 없는 정보를 찾는 데 집중하세요.
- 검색에서 확인된 데이터만 사용하세요. **확인되지 않은 가격/수치는 절대 추정하지 마세요.**
- 종목/ETF 언급 시 **반드시 티커**를 사용하세요 (예: NVDA, XLK)
- ETF 티커(QQQ)와 지수(Nasdaq)를 혼동하지 마세요
- "변동성 확대" 같은 **누구나 하는 말은 하지 마세요**
- 반드시 한국어로 작성하세요`;
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
  logger.step("[1/6] Environment validated");

  // 2. 장기 기억 + 시장 데이터 로드
  const debateDate = getDebateDate();
  logger.step("[2/6] Loading memory context & market data...");

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

  // 3. 토론 실행
  logger.step(`[3/6] Running debate for ${debateDate}...`);

  const result = await runDebate({
    question: buildDebateQuestion(debateDate),
    debateDate,
    memoryContext,
    marketDataContext,
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

  // 4. Thesis 저장
  logger.step("[4/6] Saving theses...");
  const savedCount = await saveTheses(debateDate, result.round3.theses);
  logger.info("Thesis", `${savedCount} theses saved to DB`);

  // 5. 조건부 Discord 발송
  logger.step("[5/6] Checking alert conditions...");
  const report = result.round3.report;
  const shouldAlert = checkAlertConditions(result);

  if (shouldAlert.send) {
    logger.info("Alert", `Sending report: ${shouldAlert.reason}`);

    // 핵심 요약 추출 (리포트 첫 섹션)
    const coreInsight = extractCoreInsight(report);

    const thesesSummary = result.round3.theses
      .map((t) => {
        const confidence = t.confidence === "high" ? "🔴" : t.confidence === "medium" ? "🟡" : "⚪";
        const timeframe = `${t.timeframeDays}일`;
        return `${confidence} ${t.thesis} _(${timeframe}, ${t.consensusLevel} 합의)_`;
      })
      .join("\n");

    const summary = [
      `📊 **시장 브리핑** (${debateDate})`,
      "",
      coreInsight,
      "",
      "---",
      "",
      "**검증 가능한 전망**",
      thesesSummary,
    ].join("\n");

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
          `${summary}${reportLink}`,
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
