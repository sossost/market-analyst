/**
 * 토론 백테스트 스크립트.
 *
 * stock_phases + sector_rs_daily가 있는 과거 날짜에 대해
 * 토론 → thesis 저장 → 이전 thesis 검증 → 원인 분석을 순서대로 실행.
 *
 * 뉴스 없이 시장 데이터만으로 토론하므로 실제 대비 ~70% 품질.
 *
 * Usage:
 *   npx tsx scripts/backtest-debate.ts --from 2025-12-01 --limit 5
 *   npx tsx scripts/backtest-debate.ts --dry-run
 *
 * 비용: ~$0.5-1.0/day, 시간: ~2-3min/day
 */
import "dotenv/config";
import { pool, db } from "../src/db/client.js";
import { stockPhases, sectorRsDaily } from "../src/db/schema/analyst.js";
import { sql } from "drizzle-orm";
import { runDebate } from "../src/agent/debate/debateEngine.js";
import { buildMemoryContext } from "../src/agent/debate/memoryLoader.js";
import { loadMarketSnapshot, formatMarketSnapshot } from "../src/agent/debate/marketDataLoader.js";
import { saveTheses, expireStaleTheses } from "../src/agent/debate/thesisStore.js";
import { verifyTheses } from "../src/agent/debate/thesisVerifier.js";
import { saveDebateSession, buildFewShotContext } from "../src/agent/debate/sessionStore.js";
import { logger } from "../src/agent/logger.js";

interface Args {
  from: string | null;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let from: string | null = null;
  let limit = 999;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1] != null) {
      from = args[++i];
    } else if (args[i] === "--limit" && args[i + 1] != null) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { from, limit, dryRun };
}

async function getAvailableDates(from: string | null): Promise<string[]> {
  const fromClause = from != null ? `AND sp.date >= '${from}'` : "";

  const { rows } = await pool.query<{ date: string }>(`
    SELECT DISTINCT sp.date::text AS date
    FROM stock_phases sp
    WHERE EXISTS (
      SELECT 1 FROM sector_rs_daily srd WHERE srd.date = sp.date
    )
    AND NOT EXISTS (
      SELECT 1 FROM debate_sessions ds WHERE ds.date = sp.date
    )
    ${fromClause}
    ORDER BY sp.date ASC
  `);

  return rows.map((r) => r.date);
}

function buildBacktestQuestion(debateDate: string): string {
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

## 필수 규칙
1. **제공된 데이터를 먼저 분석하라.** 데이터에 있는 종목, 섹터를 반드시 언급하라.
2. **제공된 데이터에 없는 가격/수치를 절대 지어내지 마라.** 모르면 "확인 불가"로 적어라.
3. **일반론 금지.** "유동성 확대는 위험자산에 유리" 같은 교과서적 문장은 가치 없다.
4. **모멘텀 방향을 확인하라.** RS가 높아도 5일/20일 가격 변화가 마이너스면 고점 피로감이다.
5. **미래 변화를 전망하라.** 현재 상태 묘사에 그치지 말고, 향후 1~3개월 어떤 변화가 올지 분석하라.
6. 종목/ETF 언급 시 **반드시 티커** 사용 (예: NVDA, XLK)
7. 반드시 **한국어로** 작성하세요
8. 시스템 프롬프트에 정의된 **출력 형식**을 반드시 따르세요
9. **이것은 백테스트입니다.** ${debateDate} 이후에 발생한 사건을 참조하지 마세요.
   당시 시점의 데이터만으로 분석하세요.`;
}

async function runBacktestForDate(debateDate: string): Promise<void> {
  logger.step(`\n${"=".repeat(60)}`);
  logger.step(`[${debateDate}] Backtest debate`);
  logger.step(`${"=".repeat(60)}`);

  // 1. 만료 thesis 정리
  await expireStaleTheses(debateDate);

  // 2. 기존 thesis 검증 (이전 토론의 예측을 현재 데이터로 검증)
  const marketSnapshot = await loadMarketSnapshot(debateDate);
  const marketDataContext = formatMarketSnapshot(marketSnapshot);

  try {
    const verifyResult = await verifyTheses(marketDataContext, debateDate);
    if (verifyResult.confirmed > 0 || verifyResult.invalidated > 0) {
      logger.info("Verify", `${verifyResult.confirmed} confirmed, ${verifyResult.invalidated} invalidated, ${verifyResult.held} held`);
    }
  } catch (err) {
    logger.warn("Verify", `Thesis verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. 메모리 + few-shot 로드
  const [memoryContext, fewShotContext] = await Promise.all([
    buildMemoryContext(),
    buildFewShotContext(marketSnapshot),
  ]);
  const enrichedMemory = [memoryContext, fewShotContext].filter((s) => s.length > 0).join("\n\n");

  // 4. 토론 실행 (뉴스 없음)
  logger.info("Debate", `Running debate for ${debateDate} (no news context)`);

  const result = await runDebate({
    question: buildBacktestQuestion(debateDate),
    debateDate,
    memoryContext: enrichedMemory,
    marketDataContext,
    newsContext: {},
  });

  logger.info("Debate", `R1: ${result.round1.outputs.length}/4, R2: ${result.round2.outputs.length}, R3: ${result.round3.theses.length} theses`);
  logger.info("Debate", `Tokens: ${result.metadata.totalTokens.input}/${result.metadata.totalTokens.output}, ${(result.metadata.totalDurationMs / 1000).toFixed(1)}s`);

  // 5. Thesis + 세션 저장
  const savedCount = await saveTheses(debateDate, result.round3.theses);
  logger.info("Thesis", `${savedCount} theses saved`);

  try {
    await saveDebateSession({
      debateDate,
      marketDataContext,
      marketSnapshot,
      newsContext: {},
      result,
    });
  } catch (err) {
    logger.warn("Session", `Save failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const args = parseArgs();

  console.log("=== Debate Backtest ===");
  console.log(`From: ${args.from ?? "(all available)"}`);
  console.log(`Limit: ${args.limit}`);
  console.log(`Dry run: ${args.dryRun}`);

  const dates = await getAvailableDates(args.from);
  const targetDates = dates.slice(0, args.limit);

  console.log(`\nAvailable dates: ${dates.length}, processing ${targetDates.length}`);

  if (targetDates.length === 0) {
    console.log("No dates available for backtest.");
    await pool.end();
    return;
  }

  console.log(`Range: ${targetDates[0]} ~ ${targetDates[targetDates.length - 1]}`);

  if (args.dryRun) {
    for (const date of targetDates) {
      console.log(`  ${date}`);
    }
    await pool.end();
    return;
  }

  let completed = 0;
  const startTime = Date.now();

  for (const date of targetDates) {
    await runBacktestForDate(date);
    completed++;

    const elapsed = (Date.now() - startTime) / 1000;
    const avg = elapsed / completed;
    const remaining = (targetDates.length - completed) * avg;
    console.log(`\n  Progress: ${completed}/${targetDates.length} (ETA: ${(remaining / 60).toFixed(1)}min)`);

    // Rate limiting — Claude API throttling 방지
    if (completed < targetDates.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const totalMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const totalCostEst = (completed * 0.75).toFixed(2);
  console.log(`\n=== Backtest complete: ${completed} dates in ${totalMin}min (est. cost: $${totalCostEst}) ===`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Backtest failed:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});
