/**
 * 기계적 시그널 백테스트.
 *
 * Phase 1→2 전환 시그널의 실제 수익률을 측정하여
 * "Phase 2 초입 포착이 알파를 만드는가?"를 검증한다.
 *
 * - 비용: $0 (LLM 호출 없음, 순수 DB 쿼리)
 * - 소요: ~1분
 *
 * Usage:
 *   npx tsx scripts/backtest-signals.ts
 *   npx tsx scripts/backtest-signals.ts --from 2025-10-01
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";

// ── 파라미터 조합 ──────────────────────────────────────────
const RS_THRESHOLDS = [50, 60, 70, 80];
const VOLUME_OPTIONS = [true, false]; // volume_confirmed 필수 여부
const SECTOR_FILTER_OPTIONS = [true, false]; // sector groupPhase=2 필터

const HOLD_PERIODS = [5, 10, 20, 60]; // 거래일 기준

// ── 타입 ────────────────────────────────────────────────────
interface Signal {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  rsScore: number;
  volumeConfirmed: boolean;
  sector: string | null;
  industry: string | null;
  sectorGroupPhase: number | null;
}

interface TradeResult {
  signal: Signal;
  returns: Record<number, number | null>; // holdDays → return %
  phaseExitDate: string | null;
  phaseExitReturn: number | null;
  phaseExitDays: number | null;
  maxReturn: number | null;
}

interface ParamResult {
  rsThreshold: number;
  volumeRequired: boolean;
  sectorFilter: boolean;
  totalSignals: number;
  trades: TradeResult[];
}

interface BacktestSummary {
  rsThreshold: number;
  volumeRequired: boolean;
  sectorFilter: boolean;
  totalSignals: number;
  // 고정 기간 수익률
  returns: Record<number, { avg: number; median: number; winRate: number; count: number }>;
  // Phase 종료 기준
  phaseExit: {
    avgReturn: number;
    medianReturn: number;
    winRate: number;
    avgDays: number;
    count: number;
  };
  // 최대 수익률
  avgMaxReturn: number;
}

// ── 메인 ────────────────────────────────────────────────────
async function main() {
  const fromArg = parseFrom();

  console.log("=== 기계적 시그널 백테스트 ===\n");

  // 1. 모든 Phase 1→2 전환 시그널 수집
  const signals = await findPhase2Entries(fromArg);
  console.log(`총 Phase 1→2 전환 시그널: ${signals.length}개`);

  if (signals.length === 0) {
    console.log("시그널 없음. stock_phases 데이터를 확인하세요.");
    await pool.end();
    return;
  }

  const dateRange = signals.map((s) => s.entryDate).sort();
  console.log(`기간: ${dateRange[0]} ~ ${dateRange[dateRange.length - 1]}\n`);

  // 2. 각 시그널의 이후 수익률 계산
  console.log("수익률 계산 중...");
  const trades = await calculateReturns(signals);
  console.log(`수익률 계산 완료: ${trades.length}건\n`);

  // 3. SPY 벤치마크
  const spyReturns = await calculateSpyReturns(signals);

  // 4. 파라미터 조합별 성과 집계
  const summaries: BacktestSummary[] = [];

  for (const rs of RS_THRESHOLDS) {
    for (const vol of VOLUME_OPTIONS) {
      for (const sec of SECTOR_FILTER_OPTIONS) {
        const filtered = trades.filter((t) => {
          if (t.signal.rsScore < rs) return false;
          if (vol && !t.signal.volumeConfirmed) return false;
          if (sec && t.signal.sectorGroupPhase !== 2) return false;
          return true;
        });

        if (filtered.length === 0) continue;
        summaries.push(summarize(rs, vol, sec, filtered));
      }
    }
  }

  // 5. 결과 출력
  printResults(summaries, spyReturns);

  // 6. 베스트 파라미터
  printBestParams(summaries);

  // 7. 섹터별 분석
  await printSectorBreakdown(trades);

  // 8. 결과 파일 저장
  const output = {
    runDate: new Date().toISOString(),
    dataRange: { from: dateRange[0], to: dateRange[dateRange.length - 1] },
    totalSignals: signals.length,
    spyBenchmark: spyReturns,
    paramResults: summaries,
    sectorBreakdown: buildSectorBreakdown(trades),
  };

  const outPath = `data/backtest/signal-backtest-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import("fs");
  fs.mkdirSync("data/backtest", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n결과 저장: ${outPath}`);

  await pool.end();
}

// ── 시그널 수집 ─────────────────────────────────────────────
async function findPhase2Entries(from: string | null): Promise<Signal[]> {
  const { rows } = await pool.query<{
    symbol: string;
    date: string;
    close: string;
    rs_score: number;
    volume_confirmed: boolean | null;
    sector: string | null;
    industry: string | null;
    sector_group_phase: number | null;
  }>(
    `SELECT
       sp.symbol,
       sp.date,
       dp.close,
       sp.rs_score,
       sp.volume_confirmed,
       s.sector,
       s.industry,
       srd.group_phase AS sector_group_phase
     FROM stock_phases sp
     JOIN daily_prices dp ON dp.symbol = sp.symbol AND dp.date = sp.date
     LEFT JOIN symbols s ON s.symbol = sp.symbol
     LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
     WHERE sp.phase = 2
       AND sp.prev_phase IS DISTINCT FROM 2
       AND dp.close IS NOT NULL
       ${from != null ? "AND sp.date >= $1" : ""}
     ORDER BY sp.date ASC`,
    from != null ? [from] : [],
  );

  return rows.map((r) => ({
    symbol: r.symbol,
    entryDate: r.date,
    entryPrice: parseFloat(r.close),
    rsScore: r.rs_score ?? 0,
    volumeConfirmed: r.volume_confirmed === true,
    sector: r.sector,
    industry: r.industry,
    sectorGroupPhase: r.sector_group_phase,
  }));
}

// ── 수익률 계산 ─────────────────────────────────────────────
async function calculateReturns(signals: Signal[]): Promise<TradeResult[]> {
  const maxHold = Math.max(...HOLD_PERIODS);
  const results: TradeResult[] = [];

  // 배치 처리 (한 번에 너무 많은 쿼리 방지)
  const BATCH = 100;
  for (let i = 0; i < signals.length; i += BATCH) {
    const batch = signals.slice(i, i + BATCH);

    const batchResults = await Promise.all(
      batch.map((signal) => calculateSingleReturn(signal, maxHold)),
    );
    results.push(...batchResults);

    if (i + BATCH < signals.length) {
      process.stdout.write(`  ${Math.min(i + BATCH, signals.length)}/${signals.length}\r`);
    }
  }

  return results;
}

async function calculateSingleReturn(
  signal: Signal,
  maxHold: number,
): Promise<TradeResult> {
  // 진입일 이후 N거래일의 종가 + phase 조회
  const { rows } = await pool.query<{
    date: string;
    close: string;
    phase: number;
    row_num: string;
  }>(
    `SELECT dp.date, dp.close, sp.phase,
            ROW_NUMBER() OVER (ORDER BY dp.date) AS row_num
     FROM daily_prices dp
     LEFT JOIN stock_phases sp ON sp.symbol = dp.symbol AND sp.date = dp.date
     WHERE dp.symbol = $1
       AND dp.date > $2
       AND dp.close IS NOT NULL
     ORDER BY dp.date ASC
     LIMIT $3`,
    [signal.symbol, signal.entryDate, maxHold],
  );

  const returns: Record<number, number | null> = {};
  let phaseExitDate: string | null = null;
  let phaseExitReturn: number | null = null;
  let phaseExitDays: number | null = null;
  let maxReturn: number | null = null;

  for (const row of rows) {
    const dayNum = parseInt(row.row_num, 10);
    const price = parseFloat(row.close);
    const ret = ((price - signal.entryPrice) / signal.entryPrice) * 100;

    if (maxReturn == null || ret > maxReturn) {
      maxReturn = ret;
    }

    // 고정 기간 수익률
    if (HOLD_PERIODS.includes(dayNum)) {
      returns[dayNum] = ret;
    }

    // Phase 2 이탈 시점
    if (phaseExitDate == null && row.phase !== 2 && row.phase != null) {
      phaseExitDate = row.date;
      phaseExitReturn = ret;
      phaseExitDays = dayNum;
    }
  }

  // 아직 측정 안 된 기간은 null
  for (const period of HOLD_PERIODS) {
    if (returns[period] === undefined) {
      returns[period] = null;
    }
  }

  return { signal, returns, phaseExitDate, phaseExitReturn, phaseExitDays, maxReturn };
}

// ── SPY 벤치마크 ────────────────────────────────────────────
async function calculateSpyReturns(
  signals: Signal[],
): Promise<Record<number, number>> {
  const spyReturns: Record<number, number[]> = {};
  for (const period of HOLD_PERIODS) {
    spyReturns[period] = [];
  }

  if (signals.length === 0) return spyReturns as Record<number, number>;

  // 전체 날짜 범위 산출 후 SPY 가격을 한 번에 로드
  const entryDates = signals.map((s) => s.entryDate);
  const minDate = entryDates.reduce((a, b) => (a < b ? a : b));
  const maxDate = entryDates.reduce((a, b) => (a > b ? a : b));

  const { rows: spyRows } = await pool.query<{ date: string; close: string }>(
    `SELECT date::text, close FROM daily_prices
     WHERE symbol = 'SPY' AND date >= $1 AND close IS NOT NULL
     ORDER BY date ASC`,
    [minDate],
  );

  const spyByDate = new Map<string, number>();
  const spyDates: string[] = [];
  for (const row of spyRows) {
    const price = parseFloat(row.close);
    spyByDate.set(row.date, price);
    spyDates.push(row.date);
  }

  for (const signal of signals) {
    const entryPrice = spyByDate.get(signal.entryDate);
    if (entryPrice == null) continue;

    // entryDate 이후의 거래일 인덱스 찾기
    const startIdx = spyDates.indexOf(signal.entryDate);
    if (startIdx === -1) continue;

    for (const period of HOLD_PERIODS) {
      const targetIdx = startIdx + period;
      if (targetIdx < spyDates.length) {
        const futurePrice = spyByDate.get(spyDates[targetIdx])!;
        const ret = ((futurePrice - entryPrice) / entryPrice) * 100;
        spyReturns[period].push(ret);
      }
    }
  }

  const avgSpyReturns: Record<number, number> = {};
  for (const period of HOLD_PERIODS) {
    const arr = spyReturns[period];
    avgSpyReturns[period] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }
  return avgSpyReturns;
}

// ── 집계 ────────────────────────────────────────────────────
function summarize(
  rsThreshold: number,
  volumeRequired: boolean,
  sectorFilter: boolean,
  trades: TradeResult[],
): BacktestSummary {
  const returns: BacktestSummary["returns"] = {};

  for (const period of HOLD_PERIODS) {
    const valid = trades.map((t) => t.returns[period]).filter((r): r is number => r != null);
    if (valid.length === 0) {
      returns[period] = { avg: 0, median: 0, winRate: 0, count: 0 };
      continue;
    }
    const sorted = [...valid].sort((a, b) => a - b);
    returns[period] = {
      avg: valid.reduce((a, b) => a + b, 0) / valid.length,
      median: sorted[Math.floor(sorted.length / 2)],
      winRate: (valid.filter((r) => r > 0).length / valid.length) * 100,
      count: valid.length,
    };
  }

  // Phase 종료 기준
  const phaseExits = trades.filter((t) => t.phaseExitReturn != null);
  const exitReturns = phaseExits.map((t) => t.phaseExitReturn!);
  const exitDays = phaseExits.map((t) => t.phaseExitDays!);
  const sortedExitReturns = [...exitReturns].sort((a, b) => a - b);

  const phaseExit = {
    avgReturn: exitReturns.length > 0 ? exitReturns.reduce((a, b) => a + b, 0) / exitReturns.length : 0,
    medianReturn: sortedExitReturns.length > 0 ? sortedExitReturns[Math.floor(sortedExitReturns.length / 2)] : 0,
    winRate: exitReturns.length > 0 ? (exitReturns.filter((r) => r > 0).length / exitReturns.length) * 100 : 0,
    avgDays: exitDays.length > 0 ? exitDays.reduce((a, b) => a + b, 0) / exitDays.length : 0,
    count: phaseExits.length,
  };

  const maxReturns = trades.map((t) => t.maxReturn).filter((r): r is number => r != null);
  const avgMaxReturn = maxReturns.length > 0 ? maxReturns.reduce((a, b) => a + b, 0) / maxReturns.length : 0;

  return {
    rsThreshold,
    volumeRequired,
    sectorFilter,
    totalSignals: trades.length,
    returns,
    phaseExit,
    avgMaxReturn,
  };
}

// ── 출력 ────────────────────────────────────────────────────
function printResults(summaries: BacktestSummary[], spyReturns: Record<number, number>) {
  console.log("─".repeat(100));
  console.log("SPY 벤치마크 (같은 기간 평균):");
  for (const period of HOLD_PERIODS) {
    console.log(`  ${period}일: ${spyReturns[period].toFixed(2)}%`);
  }

  console.log("\n" + "─".repeat(100));
  console.log("파라미터 조합별 성과:");
  console.log("─".repeat(100));

  const header = [
    "RS>=".padEnd(5),
    "Vol".padEnd(5),
    "Sec".padEnd(5),
    "N".padEnd(5),
    ...HOLD_PERIODS.map((p) => `${p}d`.padStart(8)),
    "Exit".padStart(8),
    "ExDays".padStart(7),
    "WinR%".padStart(7),
    "MaxR".padStart(8),
  ].join(" ");
  console.log(header);
  console.log("─".repeat(100));

  for (const s of summaries) {
    const row = [
      String(s.rsThreshold).padEnd(5),
      (s.volumeRequired ? "Y" : "N").padEnd(5),
      (s.sectorFilter ? "Y" : "N").padEnd(5),
      String(s.totalSignals).padEnd(5),
      ...HOLD_PERIODS.map((p) => {
        const r = s.returns[p];
        return r != null && r.count > 0 ? `${r.avg.toFixed(1)}%`.padStart(8) : "N/A".padStart(8);
      }),
      `${s.phaseExit.avgReturn.toFixed(1)}%`.padStart(8),
      `${s.phaseExit.avgDays.toFixed(0)}`.padStart(7),
      `${s.phaseExit.winRate.toFixed(0)}%`.padStart(7),
      `${s.avgMaxReturn.toFixed(1)}%`.padStart(8),
    ].join(" ");
    console.log(row);
  }
}

function printBestParams(summaries: BacktestSummary[]) {
  console.log("\n" + "─".repeat(100));
  console.log("베스트 파라미터:");

  // 20일 수익률 기준 베스트
  const by20d = [...summaries]
    .filter((s) => s.returns[20] != null && s.returns[20].count >= 10)
    .sort((a, b) => (b.returns[20]?.avg ?? 0) - (a.returns[20]?.avg ?? 0));

  if (by20d.length > 0) {
    const best = by20d[0];
    console.log(`  20일 수익률 기준: RS>=${best.rsThreshold}, Vol=${best.volumeRequired ? "Y" : "N"}, Sec=${best.sectorFilter ? "Y" : "N"}`);
    console.log(`    → 평균 ${best.returns[20]?.avg.toFixed(2)}%, 승률 ${best.returns[20]?.winRate.toFixed(0)}%, N=${best.returns[20]?.count}`);
  }

  // Phase 종료 수익률 기준 베스트
  const byExit = [...summaries]
    .filter((s) => s.phaseExit.count >= 10)
    .sort((a, b) => b.phaseExit.avgReturn - a.phaseExit.avgReturn);

  if (byExit.length > 0) {
    const best = byExit[0];
    console.log(`  Phase 종료 기준: RS>=${best.rsThreshold}, Vol=${best.volumeRequired ? "Y" : "N"}, Sec=${best.sectorFilter ? "Y" : "N"}`);
    console.log(`    → 평균 ${best.phaseExit.avgReturn.toFixed(2)}%, 승률 ${best.phaseExit.winRate.toFixed(0)}%, 평균 ${best.phaseExit.avgDays.toFixed(0)}일 보유, N=${best.phaseExit.count}`);
  }
}

async function printSectorBreakdown(trades: TradeResult[]) {
  console.log("\n" + "─".repeat(100));
  console.log("섹터별 성과 (Phase 종료 기준):");
  console.log("─".repeat(100));

  const bySector = new Map<string, TradeResult[]>();
  for (const t of trades) {
    const sector = t.signal.sector ?? "Unknown";
    const arr = bySector.get(sector) ?? [];
    arr.push(t);
    bySector.set(sector, arr);
  }

  const sectorStats = [...bySector.entries()]
    .map(([sector, sectorTrades]) => {
      const exits = sectorTrades.filter((t) => t.phaseExitReturn != null);
      const exitReturns = exits.map((t) => t.phaseExitReturn!);
      const avgReturn = exitReturns.length > 0 ? exitReturns.reduce((a, b) => a + b, 0) / exitReturns.length : 0;
      const winRate = exitReturns.length > 0 ? (exitReturns.filter((r) => r > 0).length / exitReturns.length) * 100 : 0;
      return { sector, total: sectorTrades.length, exits: exits.length, avgReturn, winRate };
    })
    .filter((s) => s.exits >= 3)
    .sort((a, b) => b.avgReturn - a.avgReturn);

  console.log(`${"Sector".padEnd(30)} ${"N".padStart(5)} ${"Exits".padStart(5)} ${"AvgR%".padStart(8)} ${"WinR%".padStart(7)}`);
  for (const s of sectorStats) {
    console.log(`${s.sector.padEnd(30)} ${String(s.total).padStart(5)} ${String(s.exits).padStart(5)} ${s.avgReturn.toFixed(1).padStart(7)}% ${s.winRate.toFixed(0).padStart(6)}%`);
  }
}

// ── 섹터 집계 (저장용) ──────────────────────────────────────
function buildSectorBreakdown(trades: TradeResult[]) {
  const bySector = new Map<string, TradeResult[]>();
  for (const t of trades) {
    const sector = t.signal.sector ?? "Unknown";
    const arr = bySector.get(sector) ?? [];
    arr.push(t);
    bySector.set(sector, arr);
  }

  return [...bySector.entries()].map(([sector, sectorTrades]) => {
    const exits = sectorTrades.filter((t) => t.phaseExitReturn != null);
    const exitReturns = exits.map((t) => t.phaseExitReturn!);
    const avgReturn = exitReturns.length > 0 ? exitReturns.reduce((a, b) => a + b, 0) / exitReturns.length : 0;
    const winRate = exitReturns.length > 0 ? (exitReturns.filter((r) => r > 0).length / exitReturns.length) * 100 : 0;

    const returns20 = sectorTrades.map((t) => t.returns[20]).filter((r): r is number => r != null);
    const avg20 = returns20.length > 0 ? returns20.reduce((a, b) => a + b, 0) / returns20.length : null;

    return { sector, total: sectorTrades.length, exits: exits.length, avgReturn, winRate, avg20dReturn: avg20 };
  }).sort((a, b) => b.avgReturn - a.avgReturn);
}

// ── 유틸 ────────────────────────────────────────────────────
function parseFrom(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const nextArg = args[i + 1];
    if (args[i] === "--from" && nextArg != null && !nextArg.startsWith("--")) {
      return args[++i];
    }
  }
  return null;
}

main().catch(async (err) => {
  console.error("Backtest failed:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});
