import "dotenv/config";
import { pool } from "@/db/client";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// --- Constants ---

const RS_MIN = 30;
const RS_MAX = 60;
const WEEKS_LOOKBACK = 4;
const FORWARD_WEEKS = [4, 8, 12] as const;
const TRADING_DAYS_PER_WEEK = 5;
const RS_TARGET = 70;

// --- Types ---

interface Signal {
  symbol: string;
  signalDate: string;
  rsScore: number;
  rsScore4wAgo: number;
  phase: number;
  sector: string | null;
  sectorChange4w: number | null;
}

interface ForwardData {
  rsScore: number | null;
  phase: number | null;
  close: number | null;
}

interface SignalResult {
  signal: Signal;
  entryClose: number | null;
  forward: Record<number, ForwardData>;
  sectorAligned: boolean;
}

interface PeriodStats {
  avgRsChange: number;
  medianRsChange: number;
  reachedRs70Rate: number;
  phase2Rate: number;
  count: number;
}

// --- Helpers ---

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

// --- DB Queries ---

async function getDataRange(): Promise<{ minDate: string; maxDate: string }> {
  const { rows } = await pool.query<{ min_date: string; max_date: string }>(
    `SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM stock_phases`,
  );
  return { minDate: rows[0].min_date, maxDate: rows[0].max_date };
}

async function getAvailableDates(): Promise<string[]> {
  const { rows } = await pool.query<{ date: string }>(
    `SELECT DISTINCT date FROM stock_phases ORDER BY date`,
  );
  return rows.map((r) => r.date);
}

async function collectSignals(dates: string[]): Promise<Signal[]> {
  // 시그널 수집 가능한 날짜: 4주 전 데이터가 존재하는 날짜부터
  // 그리고 12주 후 데이터가 존재하는 날짜까지 (성과 검증 가능)
  const maxForwardDays = Math.max(...FORWARD_WEEKS) * TRADING_DAYS_PER_WEEK;
  const minIdx = WEEKS_LOOKBACK * TRADING_DAYS_PER_WEEK;
  const maxIdx = dates.length - maxForwardDays;

  if (maxIdx <= minIdx) {
    console.log("데이터 기간이 검증에 충분하지 않습니다.");
    return [];
  }

  const signals: Signal[] = [];

  for (let i = minIdx; i < maxIdx; i++) {
    const currentDate = dates[i];
    const lookbackDate = dates[i - WEEKS_LOOKBACK * TRADING_DAYS_PER_WEEK];

    const { rows } = await pool.query<{
      symbol: string;
      rs_score: number;
      rs_score_4w_ago: number;
      phase: number;
      sector: string | null;
      sector_change_4w: string | null;
    }>(
      `WITH rs_4w AS (
         SELECT sp.symbol, sp.rs_score AS rs_score_4w_ago
         FROM stock_phases sp
         WHERE sp.date = $2
       )
       SELECT
         sp.symbol, sp.rs_score,
         COALESCE(r4w.rs_score_4w_ago, sp.rs_score) AS rs_score_4w_ago,
         sp.phase,
         s.sector,
         srd.change_4w::text AS sector_change_4w
       FROM stock_phases sp
       JOIN symbols s ON sp.symbol = s.symbol
       LEFT JOIN rs_4w r4w ON r4w.symbol = sp.symbol
       LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
       WHERE sp.date = $1
         AND sp.rs_score >= $3
         AND sp.rs_score <= $4
         AND (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) > 0`,
      [currentDate, lookbackDate, RS_MIN, RS_MAX],
    );

    for (const r of rows) {
      signals.push({
        symbol: r.symbol,
        signalDate: currentDate,
        rsScore: r.rs_score,
        rsScore4wAgo: r.rs_score_4w_ago,
        phase: r.phase,
        sector: r.sector,
        sectorChange4w:
          r.sector_change_4w != null ? Number(r.sector_change_4w) : null,
      });
    }
  }

  return signals;
}

// --- Analysis ---

/**
 * 시그널에 필요한 모든 날짜의 phase/price 데이터를 배치 조회한 뒤 결과를 조립한다.
 */
async function analyzeSignals(
  signals: Signal[],
  dates: string[],
): Promise<SignalResult[]> {
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  // 필요한 (symbol, date) 쌍을 수집
  const symbolSet = new Set<string>();
  const dateSet = new Set<string>();

  for (const signal of signals) {
    const signalIdx = dateIndex.get(signal.signalDate);
    if (signalIdx == null) continue;

    symbolSet.add(signal.symbol);
    dateSet.add(signal.signalDate);

    for (const weeks of FORWARD_WEEKS) {
      const fwdIdx = signalIdx + weeks * TRADING_DAYS_PER_WEEK;
      if (fwdIdx < dates.length) {
        dateSet.add(dates[fwdIdx]);
      }
    }
  }

  const symbolArr = [...symbolSet];
  const dateArr = [...dateSet].sort();

  // 배치 쿼리: stock_phases + daily_prices
  const [{ rows: phaseRows }, { rows: priceRows }] = await Promise.all([
    pool.query<{ symbol: string; date: string; rs_score: number; phase: number }>(
      `SELECT symbol, date, rs_score, phase FROM stock_phases
       WHERE symbol = ANY($1) AND date = ANY($2)`,
      [symbolArr, dateArr],
    ),
    pool.query<{ symbol: string; date: string; close: string }>(
      `SELECT symbol, date, close FROM daily_prices
       WHERE symbol = ANY($1) AND date = ANY($2)`,
      [symbolArr, dateArr],
    ),
  ]);

  // "symbol::date" → data 인덱스
  const phaseIndex = new Map<string, { rsScore: number; phase: number }>();
  for (const row of phaseRows) {
    phaseIndex.set(`${row.symbol}::${row.date}`, { rsScore: row.rs_score, phase: row.phase });
  }

  const priceIndex = new Map<string, number>();
  for (const row of priceRows) {
    priceIndex.set(`${row.symbol}::${row.date}`, Number(row.close));
  }

  // 결과 조립
  const results: SignalResult[] = [];
  const total = signals.length;

  for (let s = 0; s < total; s++) {
    const signal = signals[s];
    if ((s + 1) % 500 === 0 || s + 1 === total) {
      console.log(`  진행: ${s + 1}/${total}`);
    }

    const signalIdx = dateIndex.get(signal.signalDate);
    if (signalIdx == null) continue;

    const entryKey = `${signal.symbol}::${signal.signalDate}`;
    const entryClose = priceIndex.get(entryKey) ?? null;

    const forward: Record<number, ForwardData> = {};
    for (const weeks of FORWARD_WEEKS) {
      const fwdIdx = signalIdx + weeks * TRADING_DAYS_PER_WEEK;
      if (fwdIdx < dates.length) {
        const fwdKey = `${signal.symbol}::${dates[fwdIdx]}`;
        const phaseData = phaseIndex.get(fwdKey);
        const closeVal = priceIndex.get(fwdKey) ?? null;
        forward[weeks] = {
          rsScore: phaseData?.rsScore ?? null,
          phase: phaseData?.phase ?? null,
          close: closeVal,
        };
      } else {
        forward[weeks] = { rsScore: null, phase: null, close: null };
      }
    }

    const sectorAligned =
      signal.sectorChange4w != null && signal.sectorChange4w > 0;

    results.push({ signal, entryClose, forward, sectorAligned });
  }

  return results;
}

function computePeriodStats(
  results: SignalResult[],
  weeks: number,
): PeriodStats {
  const rsChanges: number[] = [];
  let reachedRs70 = 0;
  let reachedPhase2 = 0;
  let validCount = 0;

  for (const r of results) {
    const fwd = r.forward[weeks];
    if (fwd == null || fwd.rsScore == null) continue;
    validCount++;

    const rsChange = fwd.rsScore - r.signal.rsScore;
    rsChanges.push(rsChange);

    if (fwd.rsScore >= RS_TARGET) reachedRs70++;
    if (fwd.phase === 2) reachedPhase2++;
  }

  return {
    avgRsChange: validCount > 0 ? round1(rsChanges.reduce((a, b) => a + b, 0) / validCount) : 0,
    medianRsChange: round1(median(rsChanges)),
    reachedRs70Rate: pct(reachedRs70, validCount),
    phase2Rate: pct(reachedPhase2, validCount),
    count: validCount,
  };
}

function computeReturnStats(
  results: SignalResult[],
  weeks: number,
): { avgReturn: number; medianReturn: number } {
  const returns: number[] = [];

  for (const r of results) {
    if (r.entryClose == null) continue;
    const fwd = r.forward[weeks];
    if (fwd == null || fwd.close == null) continue;

    const ret = ((fwd.close - r.entryClose) / r.entryClose) * 100;
    returns.push(ret);
  }

  if (returns.length === 0) return { avgReturn: 0, medianReturn: 0 };

  return {
    avgReturn: round1(returns.reduce((a, b) => a + b, 0) / returns.length),
    medianReturn: round1(median(returns)),
  };
}

function computeSectorSplit(results: SignalResult[]): {
  aligned: { count: number; phase2Rate: number; avgRsChange12w: number };
  notAligned: { count: number; phase2Rate: number; avgRsChange12w: number };
} {
  const aligned = results.filter((r) => r.sectorAligned);
  const notAligned = results.filter((r) => !r.sectorAligned);

  const calcGroup = (group: SignalResult[]) => {
    let phase2Count = 0;
    const rsChanges: number[] = [];
    let validCount = 0;

    for (const r of group) {
      const fwd12 = r.forward[12];
      if (fwd12 == null || fwd12.rsScore == null) continue;
      validCount++;

      rsChanges.push(fwd12.rsScore - r.signal.rsScore);
      if (fwd12.phase === 2) phase2Count++;
    }

    return {
      count: group.length,
      phase2Rate: pct(phase2Count, validCount),
      avgRsChange12w:
        validCount > 0
          ? round1(rsChanges.reduce((a, b) => a + b, 0) / validCount)
          : 0,
    };
  };

  return {
    aligned: calcGroup(aligned),
    notAligned: calcGroup(notAligned),
  };
}

// --- Main ---

async function main() {
  console.log("=== RS 상승 초기 종목 (30~60) 사후 성과 검증 ===\n");

  // 1. 데이터 기간 감지
  const { minDate, maxDate } = await getDataRange();
  console.log(`DB 데이터 범위: ${minDate} ~ ${maxDate}`);

  const dates = await getAvailableDates();
  console.log(`총 거래일: ${dates.length}일\n`);

  // 2. 시그널 수집
  console.log("시그널 수집 중...");
  const signals = await collectSignals(dates);
  console.log(`총 시그널: ${signals.length}건\n`);

  if (signals.length === 0) {
    console.log("시그널이 없습니다. 종료합니다.");
    await pool.end();
    return;
  }

  // 3. 성과 분석
  console.log("성과 분석 중...");
  const results = await analyzeSignals(signals, dates);

  // 검증 가능 기간 계산
  const signalDates = [...new Set(signals.map((s) => s.signalDate))].sort();
  const validationFrom = signalDates[0];
  const validationTo = signalDates[signalDates.length - 1];

  // 4. 통계 산출
  const stats4w = computePeriodStats(results, 4);
  const stats8w = computePeriodStats(results, 8);
  const stats12w = computePeriodStats(results, 12);

  const return4w = computeReturnStats(results, 4);
  const return8w = computeReturnStats(results, 8);
  const return12w = computeReturnStats(results, 12);

  const sectorSplit = computeSectorSplit(results);

  // 5. 콘솔 출력
  console.log("\n" + "=".repeat(50));
  console.log("=== RS 상승 초기 종목 (30~60) 사후 성과 ===");
  console.log(`검증 기간: ${validationFrom} ~ ${validationTo}`);
  console.log(`\n총 시그널: ${signals.length}건`);

  console.log("\n평균 RS 변화:");
  console.log(`  4주 후: ${stats4w.avgRsChange >= 0 ? "+" : ""}${stats4w.avgRsChange} (중앙값: ${stats4w.medianRsChange >= 0 ? "+" : ""}${stats4w.medianRsChange})`);
  console.log(`  8주 후: ${stats8w.avgRsChange >= 0 ? "+" : ""}${stats8w.avgRsChange} (중앙값: ${stats8w.medianRsChange >= 0 ? "+" : ""}${stats8w.medianRsChange})`);
  console.log(`  12주 후: ${stats12w.avgRsChange >= 0 ? "+" : ""}${stats12w.avgRsChange} (중앙값: ${stats12w.medianRsChange >= 0 ? "+" : ""}${stats12w.medianRsChange})`);

  console.log("\n평균 주가 수익률:");
  console.log(`  4주 후: ${return4w.avgReturn >= 0 ? "+" : ""}${return4w.avgReturn}% (중앙값: ${return4w.medianReturn >= 0 ? "+" : ""}${return4w.medianReturn}%)`);
  console.log(`  8주 후: ${return8w.avgReturn >= 0 ? "+" : ""}${return8w.avgReturn}% (중앙값: ${return8w.medianReturn >= 0 ? "+" : ""}${return8w.medianReturn}%)`);
  console.log(`  12주 후: ${return12w.avgReturn >= 0 ? "+" : ""}${return12w.avgReturn}% (중앙값: ${return12w.medianReturn >= 0 ? "+" : ""}${return12w.medianReturn}%)`);

  console.log("\nRS 70+ 도달율:");
  console.log(`  8주 내: ${stats8w.reachedRs70Rate}%`);
  console.log(`  12주 내: ${stats12w.reachedRs70Rate}%`);

  console.log("\nPhase 2 전환율:");
  console.log(`  4주 내: ${stats4w.phase2Rate}%`);
  console.log(`  8주 내: ${stats8w.phase2Rate}%`);
  console.log(`  12주 내: ${stats12w.phase2Rate}%`);

  console.log("\n--- 섹터 RS 동반 상승 효과 ---");
  console.log(
    `섹터 상승 동반:  전환율 ${sectorSplit.aligned.phase2Rate}%, 평균 RS ${sectorSplit.aligned.avgRsChange12w >= 0 ? "+" : ""}${sectorSplit.aligned.avgRsChange12w} (${sectorSplit.aligned.count}건)`,
  );
  console.log(
    `섹터 비동반:     전환율 ${sectorSplit.notAligned.phase2Rate}%, 평균 RS ${sectorSplit.notAligned.avgRsChange12w >= 0 ? "+" : ""}${sectorSplit.notAligned.avgRsChange12w} (${sectorSplit.notAligned.count}건)`,
  );

  // 6. JSON 저장
  const output = {
    generatedAt: new Date().toISOString(),
    validationPeriod: { from: validationFrom, to: validationTo },
    totalSignals: signals.length,
    avgRsChange: {
      w4: stats4w.avgRsChange,
      w8: stats8w.avgRsChange,
      w12: stats12w.avgRsChange,
    },
    medianRsChange: {
      w4: stats4w.medianRsChange,
      w8: stats8w.medianRsChange,
      w12: stats12w.medianRsChange,
    },
    avgReturn: {
      w4: return4w.avgReturn,
      w8: return8w.avgReturn,
      w12: return12w.avgReturn,
    },
    medianReturn: {
      w4: return4w.medianReturn,
      w8: return8w.medianReturn,
      w12: return12w.medianReturn,
    },
    reachedRs70Rate: {
      w8: stats8w.reachedRs70Rate,
      w12: stats12w.reachedRs70Rate,
    },
    phase2ConversionRate: {
      w4: stats4w.phase2Rate,
      w8: stats8w.phase2Rate,
      w12: stats12w.phase2Rate,
    },
    sectorAligned: {
      count: sectorSplit.aligned.count,
      phase2Rate: sectorSplit.aligned.phase2Rate,
      avgRsChange12w: sectorSplit.aligned.avgRsChange12w,
    },
    sectorNotAligned: {
      count: sectorSplit.notAligned.count,
      phase2Rate: sectorSplit.notAligned.phase2Rate,
      avgRsChange12w: sectorSplit.notAligned.avgRsChange12w,
    },
  };

  const outputPath = resolve("data/review-feedback/tool-validation-rising-rs.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nJSON 저장: ${outputPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end().then(() => process.exit(1));
});
