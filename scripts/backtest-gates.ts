/**
 * recommendations 게이트 Ablation 백테스트.
 *
 * Phase 2 진입 시그널에 대해 7개 게이트 조건을 하나씩 제거했을 때
 * 성과가 어떻게 변하는지 정량 측정한다 (ablation study).
 *
 * - 비용: $0 (LLM 호출 없음, 순수 DB 쿼리)
 * - 소요: ~2분
 *
 * Usage:
 *   npx tsx scripts/backtest-gates.ts
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";
import { mkdirSync, writeFileSync } from "node:fs";

// ── 상수 ────────────────────────────────────────────────────────

/** ablation 대상 게이트 */
const GATE_NAMES = [
  "RS < 60",
  "RS > 95",
  "저가주 < $5",
  "Bear 레짐",
  "지속성 3일",
  "안정성 3연속",
  "SEPA F",
] as const;
type GateName = (typeof GATE_NAMES)[number];

const HOLD_PERIODS = [30, 60, 90] as const; // 거래일 기준

/** 게이트 유효성 판정 기준 */
const DELTA_RETURN_THRESHOLD = 0.5; // 평균 수익률 개선 pp
const DELTA_WIN_RATE_THRESHOLD = 2; // 승률 개선 pp
const FILTERED_AVG_RETURN_BAD_THRESHOLD = -2; // 차단 종목 평균 수익률
const MIN_SAMPLE_FOR_JUDGMENT = 20; // 판단 가능 최소 차단 수

/** Phase 2 지속성: 기준 기간 (캘린더일) */
const PHASE2_PERSISTENCE_CALENDAR_DAYS = 5;
/** Phase 2 지속성: 최소 포인트 수 */
const MIN_PHASE2_PERSISTENCE_COUNT = 3;
/** Phase 2 안정성: 연속 거래일 */
const PHASE2_STABILITY_DAYS = 3;

const MIN_RS_SCORE = 60;
const MAX_RS_SCORE = 95;
const MIN_PRICE = 5;
const BEAR_REGIMES = new Set(["EARLY_BEAR", "BEAR"]);

// ── 타입 ────────────────────────────────────────────────────────

interface RawSignal {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  rsScore: number;
  sector: string | null;
  marketRegime: string | null;
  phase2CountInWindow: number; // 지속성: entry 기준 과거 5캘린더일 내 phase=2 카운트
  isStable: boolean; // 안정성: 직전 3거래일 연속 phase=2
  fundamentalGrade: string | null;
}

type PeriodStats = {
  avg: number;
  median: number;
  winRate: number;
  count: number;
};

interface SignalResult {
  signal: RawSignal;
  returns: Record<number, number | null>;
  phase2Retention: Record<number, boolean | null>;
}

interface AggStats {
  n: number;
  return30d: PeriodStats;
  return60d: PeriodStats;
  return90d: PeriodStats;
  phase2RetentionAt30d: number;
  phase2RetentionAt60d: number;
  phase2RetentionAt90d: number;
  spyAlpha30d: number;
  spyAlpha60d: number;
  spyAlpha90d: number;
}

interface GateContribution {
  deltaReturn30d: number;
  deltaReturn60d: number;
  deltaReturn90d: number;
  deltaWinRate60d: number;
  filteredCount: number;
  filteredRatio: number;
  filteredAvgReturn60d: number | null;
}

interface AblationResult {
  gateName: GateName;
  withGate: AggStats;
  withoutGate: AggStats;
  gateContribution: GateContribution;
  verdict: "유효" | "검토필요" | "판단불가(샘플부족)";
  verdictReason: string;
}

// ── 메인 ────────────────────────────────────────────────────────

async function main() {
  console.log("=== recommendations 게이트 Ablation 백테스트 ===\n");

  // stock_phases 전체 기간 사용. 각 forward period의 non-null 카운트로 신뢰도 표시.
  // (122거래일 중 90일 컷오프하면 31일만 남아 표본 부족 → 컷오프 없이 full period 사용)
  const startDate = "2025-09-25";
  const cutoffDate = await getMaxDate();

  console.log(`분석 기간: ${startDate} ~ ${cutoffDate} (full period, 기간별 유효 카운트 별도 표시)`);
  console.log("시그널 수집 중...\n");

  // 1. Phase 2 진입 시그널 수집 (게이트 데이터 포함)
  const signals = await fetchSignals(startDate, cutoffDate);

  if (signals.length === 0) {
    console.error("Phase 2 진입 시그널이 0건입니다. stock_phases/daily_prices 데이터를 확인하세요.");
    await pool.end();
    process.exit(1);
  }

  console.log(`Phase 2 진입 시그널 총 ${signals.length}건\n`);

  // 2. 레짐 분포 출력
  printRegimeDistribution(signals);

  // 3. 게이트별 현재 차단율 출력
  printGateBlockRates(signals);

  // 4. daily_prices 및 stock_phases 인메모리 맵 구축
  console.log("\nforward return 데이터 로딩 중...");
  const symbols = [...new Set(signals.map((s) => s.symbol))];
  const minDate = signals.map((s) => s.entryDate).sort()[0];
  const [priceMap, futurePhaseMap] = await Promise.all([
    loadPriceMap(symbols, minDate),
    loadFuturePhaseMap(symbols, minDate),
  ]);
  console.log("로딩 완료.\n");

  // 5. S&P 500 벤치마크 (^GSPC) — 데이터 부족 시 0으로 처리
  const spyReturns = await calculateSpyReturns(signals, minDate);
  const hasSpyData = Object.values(spyReturns).some((v) => v !== 0);

  // 6. 각 시그널의 forward return 계산
  const results = computeReturns(signals, priceMap, futurePhaseMap);
  console.log(`Forward return 계산 완료: ${results.length}건\n`);

  // 7. 베이스라인 집계
  const baselineAll = aggregate(results, spyReturns);
  // withGate는 모든 게이트 적용 상태 — 각 게이트 ablation의 공통 기준점이기도 함
  const baselineWithAllGates = aggregate(applyAllGates(results), spyReturns);

  const ablationResults: AblationResult[] = [];
  for (const gateName of GATE_NAMES) {
    const withoutGateResults = applyAllGatesExcept(results, gateName); // 해당 게이트 제거
    const filteredResults = getFilteredByGate(results, gateName); // 게이트가 차단한 종목

    const withGate = baselineWithAllGates; // 전체 게이트 적용 상태가 withGate 기준점
    const withoutGate = aggregate(withoutGateResults, spyReturns);
    const filtered = aggregate(filteredResults, spyReturns);

    const filteredCount = filteredResults.length;
    const totalWithoutGate = withoutGateResults.length;

    // delta = 제거 - 적용: 양수 = 제거 시 성과 향상, 음수 = 제거 시 성과 하락(게이트 유효)
    const gateContribution: GateContribution = {
      deltaReturn30d: withoutGate.return30d.avg - withGate.return30d.avg,
      deltaReturn60d: withoutGate.return60d.avg - withGate.return60d.avg,
      deltaReturn90d: withoutGate.return90d.avg - withGate.return90d.avg,
      deltaWinRate60d: withoutGate.return60d.winRate - withGate.return60d.winRate,
      filteredCount,
      filteredRatio: totalWithoutGate > 0 ? (filteredCount / totalWithoutGate) * 100 : 0,
      filteredAvgReturn60d: filtered.return60d.count > 0 ? filtered.return60d.avg : null,
    };

    const { verdict, verdictReason } = judgeGate(gateName, gateContribution, filteredCount);

    ablationResults.push({
      gateName,
      withGate,
      withoutGate,
      gateContribution,
      verdict,
      verdictReason,
    });
  }

  // 9. 결과 출력
  printAblationResults(baselineAll, baselineWithAllGates, ablationResults, spyReturns, hasSpyData);

  // 10. JSON 저장
  const today = new Date().toISOString().slice(0, 10);
  const outPath = `data/backtest/gate-backtest-${today}.json`;
  mkdirSync("data/backtest", { recursive: true });

  const output = {
    runDate: new Date().toISOString(),
    analysisPeriod: { from: startDate, to: cutoffDate },
    totalSignals: signals.length,
    cutoffTradingDays: 90,
    spyBenchmark: spyReturns,
    baseline: {
      noGates: serializeAggStats(baselineAll),
      allGates: serializeAggStats(baselineWithAllGates),
    },
    ablation: ablationResults.map((r) => ({
      gateName: r.gateName,
      withGate: serializeAggStats(r.withGate),
      withoutGate: serializeAggStats(r.withoutGate),
      gateContribution: r.gateContribution,
      verdict: r.verdict,
      verdictReason: r.verdictReason,
    })),
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n결과 저장: ${outPath}`);

  await pool.end();
}

// ── 날짜 유틸 ────────────────────────────────────────────────────

async function getMaxDate(): Promise<string> {
  const { rows } = await pool.query<{ max_date: string }>(
    `SELECT MAX(date)::text AS max_date FROM stock_phases`,
  );
  const row = rows[0];
  if (row?.max_date == null) {
    throw new Error("stock_phases에 데이터가 없습니다.");
  }
  return row.max_date;
}

// ── 시그널 수집 ─────────────────────────────────────────────────

async function fetchSignals(startDate: string, cutoffDate: string): Promise<RawSignal[]> {
  // Phase 2 진입 시그널 + 게이트 데이터를 한 번에 수집
  const { rows } = await pool.query<{
    symbol: string;
    entry_date: string;
    close: string;
    rs_score: number;
    sector: string | null;
    market_regime: string | null;
    phase2_count: string;
    fundamental_grade: string | null;
  }>(
    `SELECT
       sp.symbol,
       sp.date AS entry_date,
       dp.close,
       sp.rs_score,
       s.sector,
       mr.regime AS market_regime,
       COALESCE(
         (SELECT COUNT(*)::text
          FROM stock_phases sp2
          WHERE sp2.symbol = sp.symbol
            AND sp2.phase = 2
            AND sp2.date >= (sp.date::date - $3::interval)::text
            AND sp2.date <= sp.date),
         '0'
       ) AS phase2_count,
       (SELECT fs.grade
        FROM fundamental_scores fs
        WHERE fs.symbol = sp.symbol
          AND fs.scored_date <= sp.date
        ORDER BY fs.scored_date DESC
        LIMIT 1
       ) AS fundamental_grade
     FROM stock_phases sp
     JOIN daily_prices dp
       ON dp.symbol = sp.symbol AND dp.date = sp.date
     LEFT JOIN symbols s
       ON s.symbol = sp.symbol
     LEFT JOIN market_regimes mr
       ON mr.regime_date = sp.date AND mr.is_confirmed = true
     WHERE sp.phase = 2
       AND sp.prev_phase IS DISTINCT FROM 2
       AND dp.close IS NOT NULL
       AND dp.close::numeric > 0
       AND sp.date >= $1
       AND sp.date <= $2
     ORDER BY sp.date ASC`,
    [startDate, cutoffDate, `${PHASE2_PERSISTENCE_CALENDAR_DAYS} days`],
  );

  // Phase 2 안정성 (직전 3거래일 연속 phase=2)을 별도 쿼리로 일괄 조회
  const stableSet = await fetchStableSymbolDates(rows.map((r) => ({ symbol: r.symbol, date: r.entry_date })));

  return rows.map((r) => ({
    symbol: r.symbol,
    entryDate: r.entry_date,
    entryPrice: parseFloat(r.close),
    rsScore: r.rs_score ?? 0,
    sector: r.sector,
    marketRegime: r.market_regime,
    phase2CountInWindow: parseInt(r.phase2_count, 10),
    isStable: stableSet.has(`${r.symbol}::${r.entry_date}`),
    fundamentalGrade: r.fundamental_grade,
  }));
}

/**
 * 각 시그널에 대해 직전 PHASE2_STABILITY_DAYS 거래일이 모두 phase=2인지 확인한다.
 * 전체를 한 번에 쿼리하여 인메모리에서 판단한다.
 */
async function fetchStableSymbolDates(
  signals: Array<{ symbol: string; date: string }>,
): Promise<Set<string>> {
  if (signals.length === 0) return new Set();

  const symbols = [...new Set(signals.map((s) => s.symbol))];
  const minDate = signals.map((s) => s.date).sort()[0];

  // 분석 기간 전체 phase 데이터를 로드
  const { rows } = await pool.query<{ symbol: string; date: string; phase: number }>(
    `SELECT symbol, date::text, phase
     FROM stock_phases
     WHERE symbol = ANY($1)
       AND date >= ($2::date - INTERVAL '14 days')::text  -- 안정성 확인을 위한 여유 기간
     ORDER BY symbol, date ASC`,
    [symbols, minDate],
  );

  // symbol → 날짜 정렬 배열
  const phaseBySymbol = new Map<string, Array<{ date: string; phase: number }>>();
  for (const row of rows) {
    const arr = phaseBySymbol.get(row.symbol) ?? [];
    arr.push({ date: row.date, phase: row.phase });
    phaseBySymbol.set(row.symbol, arr);
  }

  const stableSet = new Set<string>();
  for (const signal of signals) {
    const allPhases = phaseBySymbol.get(signal.symbol) ?? [];
    // entry date 이전 거래일 목록 (내림차순)
    const beforeEntry = allPhases
      .filter((p) => p.date < signal.date)
      .reverse(); // 최신 순

    // 데이터 부족 시 pass 처리 (안정성 게이트에서 차단하지 않음)
    if (beforeEntry.length < PHASE2_STABILITY_DAYS) {
      stableSet.add(`${signal.symbol}::${signal.date}`);
      continue;
    }

    const recentDays = beforeEntry.slice(0, PHASE2_STABILITY_DAYS);
    const allPhase2 = recentDays.every((p) => p.phase === 2);
    if (allPhase2) {
      stableSet.add(`${signal.symbol}::${signal.date}`);
    }
  }

  return stableSet;
}

// ── 인메모리 데이터 로드 ─────────────────────────────────────────

/**
 * 분석 대상 종목의 daily_prices를 한 번에 로드한다.
 * symbol → 날짜순 가격 배열 맵으로 반환.
 */
async function loadPriceMap(
  symbols: string[],
  minDate: string,
): Promise<Map<string, Array<{ date: string; close: number }>>> {
  const { rows } = await pool.query<{ symbol: string; date: string; close: string }>(
    `SELECT symbol, date::text, close
     FROM daily_prices
     WHERE symbol = ANY($1)
       AND date >= $2
       AND close IS NOT NULL
     ORDER BY symbol, date ASC`,
    [symbols, minDate],
  );

  const map = new Map<string, Array<{ date: string; close: number }>>();
  for (const row of rows) {
    const arr = map.get(row.symbol) ?? [];
    arr.push({ date: row.date, close: parseFloat(row.close) });
    map.set(row.symbol, arr);
  }

  return map;
}

/**
 * 분석 대상 종목의 stock_phases를 한 번에 로드한다.
 * symbol → 날짜순 phase 배열 맵으로 반환.
 */
async function loadFuturePhaseMap(
  symbols: string[],
  minDate: string,
): Promise<Map<string, Array<{ date: string; phase: number }>>> {
  const { rows } = await pool.query<{ symbol: string; date: string; phase: number }>(
    `SELECT symbol, date::text, phase
     FROM stock_phases
     WHERE symbol = ANY($1)
       AND date >= $2
     ORDER BY symbol, date ASC`,
    [symbols, minDate],
  );

  const map = new Map<string, Array<{ date: string; phase: number }>>();
  for (const row of rows) {
    const arr = map.get(row.symbol) ?? [];
    arr.push({ date: row.date, phase: row.phase });
    map.set(row.symbol, arr);
  }

  return map;
}

// ── Forward Return 계산 ─────────────────────────────────────────

function computeReturns(
  signals: RawSignal[],
  priceMap: Map<string, Array<{ date: string; close: number }>>,
  futurePhaseMap: Map<string, Array<{ date: string; phase: number }>>,
): SignalResult[] {
  return signals.map((signal) => {
    const allPrices = priceMap.get(signal.symbol) ?? [];
    const allPhases = futurePhaseMap.get(signal.symbol) ?? [];

    // entry date 이후 거래일만 슬라이스
    const futurePrices = allPrices.filter((p) => p.date > signal.entryDate);
    const futurePhases = allPhases.filter((p) => p.date > signal.entryDate);

    const returns: Record<number, number | null> = {};
    const phase2Retention: Record<number, boolean | null> = {};

    for (const period of HOLD_PERIODS) {
      // N번째 거래일 (1-indexed)
      const priceRow = futurePrices[period - 1] ?? null;
      if (priceRow == null) {
        returns[period] = null;
        phase2Retention[period] = null;
      } else {
        returns[period] = ((priceRow.close - signal.entryPrice) / signal.entryPrice) * 100;

        // phase: 동일 날짜의 phase 조회
        const phaseRow = futurePhases.find((p) => p.date === priceRow.date) ?? null;
        phase2Retention[period] = phaseRow != null ? phaseRow.phase === 2 : null;
      }
    }

    return { signal, returns, phase2Retention };
  });
}

// ── S&P 500 벤치마크 ────────────────────────────────────────────

async function calculateSpyReturns(
  signals: RawSignal[],
  minDate: string,
): Promise<Record<number, number>> {
  // ^GSPC (S&P 500 인덱스) from index_prices — SPY는 ETF 필터링으로 daily_prices에 없음
  const { rows } = await pool.query<{ date: string; close: string }>(
    `SELECT date::text, close
     FROM index_prices
     WHERE symbol = '^GSPC' AND date >= $1 AND close IS NOT NULL
     ORDER BY date ASC`,
    [minDate],
  );

  const spyPrices: Array<{ date: string; close: number }> = rows.map((r) => ({
    date: r.date,
    close: parseFloat(r.close),
  }));
  const spyByDate = new Map(spyPrices.map((r) => [r.date, r.close]));
  const spyDates = spyPrices.map((r) => r.date);
  const spyDateIndex = new Map(spyDates.map((d, i) => [d, i]));

  const spyReturnBuckets: Record<number, number[]> = {};
  for (const period of HOLD_PERIODS) {
    spyReturnBuckets[period] = [];
  }

  for (const signal of signals) {
    const entryPrice = spyByDate.get(signal.entryDate);
    if (entryPrice == null) continue;

    const startIdx = spyDateIndex.get(signal.entryDate) ?? -1;
    if (startIdx === -1) continue;

    for (const period of HOLD_PERIODS) {
      const targetIdx = startIdx + period;
      if (targetIdx < spyDates.length) {
        const futurePrice = spyByDate.get(spyDates[targetIdx]);
        if (futurePrice != null) {
          const ret = ((futurePrice - entryPrice) / entryPrice) * 100;
          spyReturnBuckets[period].push(ret);
        }
      }
    }
  }

  const spyAvg: Record<number, number> = {};
  for (const period of HOLD_PERIODS) {
    const arr = spyReturnBuckets[period];
    spyAvg[period] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  return spyAvg;
}

// ── 게이트 필터링 ────────────────────────────────────────────────

/**
 * 개별 시그널이 특정 게이트를 통과하는지 판단한다.
 * 반환값: true = 통과, false = 차단
 */
function passesGate(result: SignalResult, gate: GateName): boolean {
  const { signal } = result;
  switch (gate) {
    case "RS < 60":
      return signal.rsScore >= MIN_RS_SCORE;
    case "RS > 95":
      return signal.rsScore <= MAX_RS_SCORE;
    case "저가주 < $5":
      return signal.entryPrice >= MIN_PRICE;
    case "Bear 레짐":
      return signal.marketRegime == null || !BEAR_REGIMES.has(signal.marketRegime);
    case "지속성 3일":
      return signal.phase2CountInWindow >= MIN_PHASE2_PERSISTENCE_COUNT;
    case "안정성 3연속":
      return signal.isStable;
    case "SEPA F":
      return signal.fundamentalGrade !== "F";
  }
}

/**
 * 전체 게이트 적용 (특정 게이트를 제외한 나머지 적용).
 * excludeGate == null이면 모든 게이트 적용.
 */
function applyAllGatesExcept(
  results: SignalResult[],
  excludeGate: GateName | null,
): SignalResult[] {
  return results.filter((r) =>
    GATE_NAMES.every(
      (gate) => gate === excludeGate || passesGate(r, gate),
    ),
  );
}

/** 모든 게이트 적용 (excludeGate 없음) */
function applyAllGates(results: SignalResult[]): SignalResult[] {
  return applyAllGatesExcept(results, null);
}

/**
 * 특정 게이트에 의해 차단되는 종목만 반환.
 * 나머지 게이트는 모두 통과한 상태에서 해당 게이트만 차단하는 종목.
 */
function getFilteredByGate(results: SignalResult[], gate: GateName): SignalResult[] {
  return results.filter((r) => {
    // 나머지 게이트 전부 통과
    const passesOtherGates = GATE_NAMES.every(
      (g) => g === gate || passesGate(r, g),
    );
    // 해당 게이트는 차단
    const blockedByThisGate = !passesGate(r, gate);
    return passesOtherGates && blockedByThisGate;
  });
}

// ── 집계 ────────────────────────────────────────────────────────

function aggregate(results: SignalResult[], spyReturns: Record<number, number>): AggStats {
  const n = results.length;

  if (n === 0) {
    const emptyPeriodStats: PeriodStats = { avg: 0, median: 0, winRate: 0, count: 0 };
    return {
      n: 0,
      return30d: emptyPeriodStats,
      return60d: emptyPeriodStats,
      return90d: emptyPeriodStats,
      phase2RetentionAt30d: 0,
      phase2RetentionAt60d: 0,
      phase2RetentionAt90d: 0,
      spyAlpha30d: 0,
      spyAlpha60d: 0,
      spyAlpha90d: 0,
    };
  }

  function calcPeriodStats(period: number): PeriodStats {
    const valid = results
      .map((r) => r.returns[period])
      .filter((v): v is number => v != null);
    if (valid.length === 0) return { avg: 0, median: 0, winRate: 0, count: 0 };
    const sorted = [...valid].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    return {
      avg: valid.reduce((a, b) => a + b, 0) / valid.length,
      median,
      winRate: (valid.filter((r) => r > 0).length / valid.length) * 100,
      count: valid.length,
    };
  }

  function calcRetention(period: number): number {
    const valid = results
      .map((r) => r.phase2Retention[period])
      .filter((v): v is boolean => v != null);
    if (valid.length === 0) return 0;
    return (valid.filter(Boolean).length / valid.length) * 100;
  }

  const return30d = calcPeriodStats(30);
  const return60d = calcPeriodStats(60);
  const return90d = calcPeriodStats(90);

  return {
    n,
    return30d,
    return60d,
    return90d,
    phase2RetentionAt30d: calcRetention(30),
    phase2RetentionAt60d: calcRetention(60),
    phase2RetentionAt90d: calcRetention(90),
    spyAlpha30d: return30d.avg - (spyReturns[30] ?? 0),
    spyAlpha60d: return60d.avg - (spyReturns[60] ?? 0),
    spyAlpha90d: return90d.avg - (spyReturns[90] ?? 0),
  };
}

// ── 게이트 판정 ─────────────────────────────────────────────────

function judgeGate(
  gateName: GateName,
  contribution: GateContribution,
  filteredCount: number,
): { verdict: AblationResult["verdict"]; verdictReason: string } {
  if (filteredCount < MIN_SAMPLE_FOR_JUDGMENT) {
    return {
      verdict: "판단불가(샘플부족)",
      verdictReason: `차단 종목 ${filteredCount}건 < 기준 ${MIN_SAMPLE_FOR_JUDGMENT}건`,
    };
  }

  // delta = 제거 - 적용: 음수 = 제거하면 성과 하락 → 게이트 유효
  const gateImprovedReturn = contribution.deltaReturn60d < -DELTA_RETURN_THRESHOLD;
  const gateImprovedWinRate = contribution.deltaWinRate60d < -DELTA_WIN_RATE_THRESHOLD;
  const filteredAreBad =
    contribution.filteredAvgReturn60d != null &&
    contribution.filteredAvgReturn60d < FILTERED_AVG_RETURN_BAD_THRESHOLD;

  if (gateImprovedReturn || gateImprovedWinRate || filteredAreBad) {
    const reasons: string[] = [];
    if (gateImprovedReturn) {
      reasons.push(`제거 시 60d수익률 ${contribution.deltaReturn60d.toFixed(1)}pp 하락`);
    }
    if (gateImprovedWinRate) {
      reasons.push(`제거 시 60d승률 ${contribution.deltaWinRate60d.toFixed(1)}pp 하락`);
    }
    if (filteredAreBad) {
      reasons.push(`차단 종목 avg60d=${contribution.filteredAvgReturn60d?.toFixed(1)}%`);
    }
    return { verdict: "유효", verdictReason: reasons.join(", ") };
  }

  return {
    verdict: "검토필요",
    verdictReason: `제거 시 성과 변화 미미 또는 개선 (Δ60d=${contribution.deltaReturn60d > 0 ? "+" : ""}${contribution.deltaReturn60d.toFixed(1)}pp)`,
  };
}

// ── 출력 ────────────────────────────────────────────────────────

function printRegimeDistribution(signals: RawSignal[]) {
  const regimeCounts = new Map<string, number>();
  for (const s of signals) {
    const key = s.marketRegime ?? "미분류";
    regimeCounts.set(key, (regimeCounts.get(key) ?? 0) + 1);
  }

  console.log("=== 레짐 분포 ===");
  for (const [regime, count] of [...regimeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = ((count / signals.length) * 100).toFixed(1);
    console.log(`  ${regime.padEnd(15)}: ${count}건 (${pct}%)`);
  }
}

function printGateBlockRates(signals: RawSignal[]) {
  console.log("\n=== 게이트별 현재 차단율 (단순 카운트) ===");

  const dummyResults: SignalResult[] = signals.map((s) => ({
    signal: s,
    returns: { 30: null, 60: null, 90: null },
    phase2Retention: { 30: null, 60: null, 90: null },
  }));

  for (const gate of GATE_NAMES) {
    const blocked = dummyResults.filter((r) => !passesGate(r, gate)).length;
    const pct = ((blocked / signals.length) * 100).toFixed(1);
    const warning = blocked < MIN_SAMPLE_FOR_JUDGMENT ? " (!경고: 샘플부족)" : "";
    console.log(`  ${gate.padEnd(20)}: ${blocked}건 (${pct}%)${warning}`);
  }
}

function printAblationResults(
  baselineAll: AggStats,
  baselineWithAllGates: AggStats,
  ablationResults: AblationResult[],
  spyReturns: Record<number, number>,
  hasSpyData: boolean,
) {
  const f2 = (n: number) => n.toFixed(2);
  const f1 = (n: number) => n.toFixed(1);

  console.log("\n" + "=".repeat(100));
  console.log("=== 게이트 Ablation 결과 ===");
  console.log("=".repeat(100));

  if (hasSpyData) {
    console.log(`\nS&P 500 벤치마크 (^GSPC)`);
    console.log(`  30d: ${f2(spyReturns[30])}%  60d: ${f2(spyReturns[60])}%  90d: ${f2(spyReturns[90])}%`);
  } else {
    console.log(`\nS&P 500 벤치마크: N/A (^GSPC 데이터 부족 — 분석 기간과 미겹침)`);
  }

  console.log(`\n기준선 (게이트 없음)`);
  printAggLine(baselineAll);

  console.log(`\n현재 전체 게이트 적용`);
  printAggLine(baselineWithAllGates);
  if (baselineAll.n > 0) {
    const passRate = ((baselineWithAllGates.n / baselineAll.n) * 100).toFixed(1);
    const blockRate = (((baselineAll.n - baselineWithAllGates.n) / baselineAll.n) * 100).toFixed(1);
    console.log(`  게이트 차단율: ${blockRate}% (통과 ${passRate}%, ${baselineWithAllGates.n}/${baselineAll.n}건)`);
  }

  console.log("\n개별 게이트 기여도");

  // 테이블 헤더
  const col = {
    gate: 22,
    blocked: 6,
    blockedPct: 6,
    avg60d: 8,
    winRate60d: 8,
    delta60d: 10,
    verdict: 14,
  };
  const header =
    "게이트".padEnd(col.gate) +
    "차단N".padStart(col.blocked) +
    "차단%".padStart(col.blockedPct) +
    "60d평균".padStart(col.avg60d) +
    "60d승률".padStart(col.winRate60d) +
    "제거시Δ60d".padStart(col.delta60d) +
    "판정".padStart(col.verdict);

  console.log("─".repeat(header.length));
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of ablationResults) {
    const { gateName, withGate, gateContribution, verdict } = r;
    const blockedStr = String(gateContribution.filteredCount).padStart(col.blocked);
    const blockedPctStr = `${f1(gateContribution.filteredRatio)}%`.padStart(col.blockedPct);
    const avg60dStr = `${f1(withGate.return60d.avg)}%`.padStart(col.avg60d);
    const winRate60dStr = `${f1(withGate.return60d.winRate)}%`.padStart(col.winRate60d);
    const delta = gateContribution.deltaReturn60d;
    const deltaStr = `${delta >= 0 ? "+" : ""}${f1(delta)}%`.padStart(col.delta60d);
    const verdictStr = verdict.padStart(col.verdict);

    const gateLabel =
      gateContribution.filteredCount < MIN_SAMPLE_FOR_JUDGMENT
        ? `${gateName}(!경고:N<20)`
        : gateName;

    console.log(
      gateLabel.padEnd(col.gate) +
        blockedStr +
        blockedPctStr +
        avg60dStr +
        winRate60dStr +
        deltaStr +
        verdictStr,
    );
  }
  console.log("─".repeat(header.length));

  // 검토필요 게이트 요약
  const reviewNeeded = ablationResults.filter((r) => r.verdict === "검토필요");
  if (reviewNeeded.length > 0) {
    console.log("\n검토 필요 게이트:");
    for (const r of reviewNeeded) {
      console.log(`  ${r.gateName}`);
      console.log(`    → ${r.verdictReason}`);
      console.log(
        `    → 차단 종목 avg60d: ${r.gateContribution.filteredAvgReturn60d != null ? f1(r.gateContribution.filteredAvgReturn60d) + "%" : "N/A"}`,
      );
    }
  }

  // 상세 ablation 테이블 (withGate vs withoutGate)
  console.log("\n" + "─".repeat(100));
  console.log("게이트별 상세 (게이트 제거 전후 비교)");
  console.log("─".repeat(100));
  for (const r of ablationResults) {
    console.log(`\n[${r.gateName}]  차단: ${r.gateContribution.filteredCount}건  판정: ${r.verdict}`);
    console.log(`  게이트 적용 (N=${r.withGate.n}):   30d=${f1(r.withGate.return30d.avg)}%(승${f1(r.withGate.return30d.winRate)}%)  60d=${f1(r.withGate.return60d.avg)}%(승${f1(r.withGate.return60d.winRate)}%)  90d=${f1(r.withGate.return90d.avg)}%(승${f1(r.withGate.return90d.winRate)}%)  SP알파60d=${f1(r.withGate.spyAlpha60d)}%`);
    console.log(`  게이트 제거 (N=${r.withoutGate.n}):   30d=${f1(r.withoutGate.return30d.avg)}%(승${f1(r.withoutGate.return30d.winRate)}%)  60d=${f1(r.withoutGate.return60d.avg)}%(승${f1(r.withoutGate.return60d.winRate)}%)  90d=${f1(r.withoutGate.return90d.avg)}%(승${f1(r.withoutGate.return90d.winRate)}%)  SP알파60d=${f1(r.withoutGate.spyAlpha60d)}%`);
    console.log(`  Phase2 유지율 (적용시): 30d=${f1(r.withGate.phase2RetentionAt30d)}%  60d=${f1(r.withGate.phase2RetentionAt60d)}%  90d=${f1(r.withGate.phase2RetentionAt90d)}%`);
  }
}

function printAggLine(stats: AggStats) {
  const f1 = (n: number) => n.toFixed(1);
  console.log(
    `  N=${stats.n} | ` +
      `30d: avg=${f1(stats.return30d.avg)}% med=${f1(stats.return30d.median)}% win=${f1(stats.return30d.winRate)}% | ` +
      `60d: avg=${f1(stats.return60d.avg)}% med=${f1(stats.return60d.median)}% win=${f1(stats.return60d.winRate)}% | ` +
      `90d: avg=${f1(stats.return90d.avg)}% med=${f1(stats.return90d.median)}% win=${f1(stats.return90d.winRate)}%`,
  );
  console.log(
    `  S&P 대비 알파: 30d=${f1(stats.spyAlpha30d)}%  60d=${f1(stats.spyAlpha60d)}%  90d=${f1(stats.spyAlpha90d)}%`,
  );
  console.log(
    `  Phase2 유지율: 30d=${f1(stats.phase2RetentionAt30d)}%  60d=${f1(stats.phase2RetentionAt60d)}%  90d=${f1(stats.phase2RetentionAt90d)}%`,
  );
}

// ── JSON 직렬화 헬퍼 ────────────────────────────────────────────

function serializeAggStats(stats: AggStats) {
  return {
    n: stats.n,
    return30d: stats.return30d,
    return60d: stats.return60d,
    return90d: stats.return90d,
    phase2RetentionAt30d: stats.phase2RetentionAt30d,
    phase2RetentionAt60d: stats.phase2RetentionAt60d,
    phase2RetentionAt90d: stats.phase2RetentionAt90d,
    spyAlpha30d: stats.spyAlpha30d,
    spyAlpha60d: stats.spyAlpha60d,
    spyAlpha90d: stats.spyAlpha90d,
  };
}

// ── 진입점 ──────────────────────────────────────────────────────

main().catch(async (err) => {
  console.error("Backtest failed:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});
