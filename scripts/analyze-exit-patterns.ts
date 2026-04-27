/**
 * EXITED 종목 패턴 분석 스크립트.
 *
 * tracked_stocks에서 EXITED 종목을 조회하고 다차원 분석을 수행한다:
 * 1. exit_reason별 분포 (phase_exit vs 기타)
 * 2. entry_date 레짐 전환기 집중도
 * 3. holding_days 분포 (flash/short/medium/long)
 * 4. RS 대역별 승률/PnL
 * 5. 승자 vs 패자 프로파일
 * 6. STABILITY_DAYS=5 시뮬레이션
 *
 * 비용: $0 (LLM 호출 없음, 순수 DB 쿼리)
 * 소요: ~1분
 *
 * Usage:
 *   npx tsx scripts/analyze-exit-patterns.ts
 *
 * Issue #997
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExitPatternReport,
  simulateStabilityFilter,
  type ExitedPosition,
  type ExitPatternReport,
  type StabilitySimulationResult,
} from "../src/etl/utils/exitPatternAnalysis.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 출력 포맷터 ─────────────────────────────────────────────────
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

// ── 상수 ────────────────────────────────────────────────────────

/** 레짐 전환기 (EARLY_BEAR → MID_BULL) */
const REGIME_TRANSITION_START = "2026-04-13";
const REGIME_TRANSITION_END = "2026-04-17";

/** 현재 안정성 기준 */
const CURRENT_STABILITY_DAYS = 3;
/** 시뮬레이션 안정성 기준 */
const SIMULATED_STABILITY_DAYS = 5;

// ── DB 조회 ─────────────────────────────────────────────────────

interface ExitedRow {
  symbol: string;
  entry_date: string;
  exit_date: string | null;
  days_tracked: number | null;
  entry_rs_score: string | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  exit_reason: string | null;
  source: string;
  tier: string;
  market_regime: string | null;
}

async function fetchExitedPositions(): Promise<ExitedPosition[]> {
  const { rows } = await pool.query<ExitedRow>(
    `SELECT
       symbol, entry_date::text, exit_date::text,
       days_tracked,
       entry_rs_score::text, pnl_percent::text, max_pnl_percent::text,
       exit_reason, source, tier, market_regime
     FROM tracked_stocks
     WHERE status = 'EXITED'
     ORDER BY entry_date ASC`,
  );

  return rows.map((r) => ({
    symbol: r.symbol,
    entryDate: r.entry_date,
    exitDate: r.exit_date,
    holdingDays: r.days_tracked ?? 0,
    entryRsScore: r.entry_rs_score != null ? parseFloat(r.entry_rs_score) : null,
    pnlPercent: r.pnl_percent != null ? parseFloat(r.pnl_percent) : null,
    maxPnlPercent: r.max_pnl_percent != null ? parseFloat(r.max_pnl_percent) : null,
    exitReason: r.exit_reason,
    source: r.source,
    tier: r.tier,
    marketRegime: r.market_regime,
  }));
}

async function fetchPhaseHistory(
  symbols: string[],
): Promise<Map<string, Array<{ date: string; phase: number }>>> {
  if (symbols.length === 0) return new Map();

  const { rows } = await pool.query<{
    symbol: string;
    date: string;
    phase: number;
  }>(
    `SELECT symbol, date::text, phase
     FROM stock_phases
     WHERE symbol = ANY($1)
     ORDER BY symbol, date ASC`,
    [symbols],
  );

  const map = new Map<string, Array<{ date: string; phase: number }>>();
  for (const row of rows) {
    const arr = map.get(row.symbol) ?? [];
    arr.push({ date: row.date, phase: row.phase });
    map.set(row.symbol, arr);
  }

  return map;
}

// ── 출력 ────────────────────────────────────────────────────────

function printReport(report: ExitPatternReport) {
  console.log("=".repeat(80));
  console.log("EXITED 종목 패턴 분석 리포트");
  console.log("=".repeat(80));

  console.log(`\n총 EXITED: ${report.totalExited}건`);
  console.log(`전체 승률: ${f1(report.overallWinRate)}%`);
  console.log(`전체 평균 PnL: ${f2(report.overallAvgPnl)}%`);
  console.log(`전체 평균 보유일: ${f1(report.overallAvgHoldingDays)}일`);

  // RS 대역별
  console.log("\n── RS 대역별 성과 ──────────────────────────────────────────");
  console.log(
    "대역".padEnd(12) +
      "건수".padStart(6) +
      "승자".padStart(6) +
      "승률".padStart(8) +
      "avg PnL".padStart(10) +
      "avg maxPnL".padStart(12),
  );
  console.log("─".repeat(54));
  for (const s of report.byRsBand) {
    console.log(
      s.band.padEnd(12) +
        String(s.count).padStart(6) +
        String(s.winnerCount).padStart(6) +
        `${f1(s.winRate)}%`.padStart(8) +
        `${f2(s.avgPnl)}%`.padStart(10) +
        `${f2(s.avgMaxPnl)}%`.padStart(12),
    );
  }

  // 보유 기간별
  console.log("\n── 보유 기간별 성과 ────────────────────────────────────────");
  console.log(
    "기간".padEnd(12) +
      "건수".padStart(6) +
      "승자".padStart(6) +
      "승률".padStart(8) +
      "avg PnL".padStart(10),
  );
  console.log("─".repeat(42));
  for (const s of report.byHoldingDuration) {
    const label = {
      flash: "1-2일",
      short: "3-7일",
      medium: "8-30일",
      long: "31일+",
    }[s.duration];
    console.log(
      (label ?? s.duration).padEnd(12) +
        String(s.count).padStart(6) +
        String(s.winnerCount).padStart(6) +
        `${f1(s.winRate)}%`.padStart(8) +
        `${f2(s.avgPnl)}%`.padStart(10),
    );
  }

  // exit_reason별
  console.log("\n── exit_reason별 성과 ──────────────────────────────────────");
  console.log(
    "사유".padEnd(28) +
      "건수".padStart(6) +
      "승률".padStart(8) +
      "avg PnL".padStart(10) +
      "avg 보유일".padStart(10),
  );
  console.log("─".repeat(62));
  for (const s of report.byExitReason) {
    console.log(
      s.reason.padEnd(28) +
        String(s.count).padStart(6) +
        `${f1(s.winRate)}%`.padStart(8) +
        `${f2(s.avgPnl)}%`.padStart(10) +
        `${f1(s.avgHoldingDays)}일`.padStart(10),
    );
  }

  // 레짐 전환기
  const rt = report.regimeTransition;
  console.log("\n── 레짐 전환기 진입 분석 ───────────────────────────────────");
  console.log(`전환기(${REGIME_TRANSITION_START}~${REGIME_TRANSITION_END}) 진입: ${rt.withinTransition}건`);
  console.log(`  승률: ${f1(rt.withinTransitionWinRate)}%, avg PnL: ${f2(rt.withinTransitionAvgPnl)}%`);
  console.log(`전환기 외 진입: ${rt.outsideTransition}건`);
  console.log(`  승률: ${f1(rt.outsideTransitionWinRate)}%, avg PnL: ${f2(rt.outsideTransitionAvgPnl)}%`);

  // 승자/패자 프로파일
  const wl = report.winnerLoserProfile;
  console.log("\n── 승자 vs 패자 프로파일 ───────────────────────────────────");
  console.log(`승자 (${wl.winners.count}건):`);
  console.log(`  avg 보유일: ${f1(wl.winners.avgHoldingDays)}, avg RS: ${wl.winners.avgRsScore != null ? f1(wl.winners.avgRsScore) : "N/A"}`);
  console.log(`  avg PnL: ${f2(wl.winners.avgPnl)}%, avg maxPnL: ${f2(wl.winners.avgMaxPnl)}%`);
  console.log(`패자 (${wl.losers.count}건):`);
  console.log(`  avg 보유일: ${f1(wl.losers.avgHoldingDays)}, avg RS: ${wl.losers.avgRsScore != null ? f1(wl.losers.avgRsScore) : "N/A"}`);
  console.log(`  avg PnL: ${f2(wl.losers.avgPnl)}%, avg maxPnL: ${f2(wl.losers.avgMaxPnl)}%`);
}

function printStabilitySimulation(sim: StabilitySimulationResult) {
  console.log("\n── STABILITY_DAYS 시뮬레이션 ───────────────────────────────");
  console.log(`현재 기준: ${CURRENT_STABILITY_DAYS}일 → 시뮬레이션: ${SIMULATED_STABILITY_DAYS}일`);
  console.log(`원래 EXITED: ${sim.originalCount}건`);
  console.log(`데이터 부족 제외: ${sim.insufficientDataCount}건`);
  console.log(`추가 차단: ${sim.additionallyBlockedCount}건`);
  console.log(`남은 종목: ${sim.filteredCount}건`);

  if (sim.blockedAvgPnl != null && sim.blockedWinRate != null) {
    console.log(`추가 차단 종목 성과: avg PnL ${f2(sim.blockedAvgPnl)}%, 승률 ${f1(sim.blockedWinRate)}%`);
  }
  if (sim.remainingAvgPnl != null && sim.remainingWinRate != null) {
    console.log(`남은 종목 성과: avg PnL ${f2(sim.remainingAvgPnl)}%, 승률 ${f1(sim.remainingWinRate)}%`);
  }

  if (sim.additionallyBlockedCount === 0) {
    console.log("→ STABILITY_DAYS 증가로 추가 차단되는 종목 없음. 효과 미미.");
  } else if (sim.blockedAvgPnl != null && sim.blockedAvgPnl < 0) {
    console.log("→ 추가 차단 종목의 avg PnL이 음수 — 필터 강화 유효.");
  } else {
    console.log("→ 추가 차단 종목의 avg PnL이 양수 — 필터 강화 불필요.");
  }
}

// ── 메인 ────────────────────────────────────────────────────────

async function main() {
  console.log("EXITED 종목 패턴 분석 시작...\n");

  // 1. EXITED 종목 조회
  const positions = await fetchExitedPositions();

  if (positions.length === 0) {
    console.log("EXITED 종목 없음. 분석 종료.");
    await pool.end();
    return;
  }

  console.log(`EXITED 종목 ${positions.length}건 로드 완료.`);

  // 2. 기본 분석 리포트
  const report = buildExitPatternReport(
    positions,
    REGIME_TRANSITION_START,
    REGIME_TRANSITION_END,
  );

  printReport(report);

  // 3. STABILITY_DAYS 시뮬레이션
  const symbols = [...new Set(positions.map((p) => p.symbol))];
  console.log(`\nPhase 히스토리 로딩 중 (${symbols.length}개 종목)...`);
  const phaseHistory = await fetchPhaseHistory(symbols);
  console.log("로딩 완료.");

  const simulation = simulateStabilityFilter(
    positions,
    phaseHistory,
    CURRENT_STABILITY_DAYS,
    SIMULATED_STABILITY_DAYS,
  );

  printStabilitySimulation(simulation);

  // 4. JSON 저장
  const today = new Date().toISOString().slice(0, 10);
  const outDir = resolve(__dirname, "../data/backtest");
  const outPath = resolve(outDir, `exit-patterns-${today}.json`);
  mkdirSync(outDir, { recursive: true });

  const output = {
    runDate: new Date().toISOString(),
    totalExited: positions.length,
    regimeTransitionPeriod: {
      start: REGIME_TRANSITION_START,
      end: REGIME_TRANSITION_END,
    },
    report,
    stabilitySimulation: {
      currentDays: CURRENT_STABILITY_DAYS,
      simulatedDays: SIMULATED_STABILITY_DAYS,
      ...simulation,
    },
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n결과 저장: ${outPath}`);

  await pool.end();
}

main().catch(async (err: unknown) => {
  console.error(
    "Exit pattern analysis failed:",
    err instanceof Error ? err.stack ?? err.message : String(err),
  );
  await pool.end();
  process.exit(1);
});
