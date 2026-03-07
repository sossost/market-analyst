import "dotenv/config";
import { pool } from "../src/db/client.js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// --- Constants ---

const LOOKAHEAD_WINDOWS = [20, 40, 60] as const;
const MONTHS_BUFFER = 3; // 시그널 이후 최소 3개월(~60 거래일) 사후 데이터 필요

// --- Types ---

interface Signal {
  symbol: string;
  date: string;
  rs_score: number;
  ma150_slope: number;
  vol_ratio: number;
  prev_phase: number | null;
}

interface PhaseRecord {
  phase: number;
  date: string;
}

interface ConversionResult {
  totalSignals: number;
  conversionRate20d: number;
  conversionRate40d: number;
  conversionRate60d: number;
  falsePositiveRate: number;
  phase2In20d: number;
  phase2In40d: number;
  phase2In60d: number;
  phase4Count: number;
  byPrevPhase: Record<string, { count: number; conversionRate60d: number }>;
}

interface ValidationOutput {
  generatedAt: string;
  validationPeriod: { from: string; to: string };
  dataRange: { from: string; to: string };
  withFilter: ConversionResult;
  withoutFilter: ConversionResult;
}

// --- Helpers ---

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

/**
 * 시그널 목록의 모든 (symbol, date) 조합에 대해 미래 phase 이력을 배치 조회한다.
 * 결과를 "symbol::signalDate" → PhaseRecord[] 맵으로 반환한다.
 */
async function batchGetFuturePhases(
  signals: Signal[],
  maxDays: number,
): Promise<Map<string, PhaseRecord[]>> {
  const symbols = [...new Set(signals.map((s) => s.symbol))];
  const dates = [...new Set(signals.map((s) => s.date))];

  // 배치 쿼리: 대상 종목 전체의 phase 데이터를 한 번에 조회
  const { rows } = await pool.query<{ symbol: string; phase: number; date: string }>(
    `SELECT symbol, phase, date
     FROM stock_phases
     WHERE symbol = ANY($1)
       AND date > $2
     ORDER BY symbol, date ASC`,
    [symbols, dates.sort()[0]], // 가장 이른 시그널 날짜 이후 전체 조회
  );

  // symbol → date → phase 인덱스 구축
  const phasesBySymbol = new Map<string, { phase: number; date: string }[]>();
  for (const row of rows) {
    const arr = phasesBySymbol.get(row.symbol) ?? [];
    arr.push({ phase: row.phase, date: row.date });
    phasesBySymbol.set(row.symbol, arr);
  }

  // 각 시그널에 대해 해당 시그널 날짜 이후 maxDays개 레코드를 슬라이스
  const result = new Map<string, PhaseRecord[]>();
  for (const signal of signals) {
    const key = `${signal.symbol}::${signal.date}`;
    const allPhases = phasesBySymbol.get(signal.symbol) ?? [];
    const startIdx = allPhases.findIndex((p) => p.date > signal.date);
    if (startIdx === -1) {
      result.set(key, []);
    } else {
      result.set(key, allPhases.slice(startIdx, startIdx + maxDays));
    }
  }

  return result;
}

/**
 * 시그널 집합에 대해 전환율을 계산한다.
 */
async function analyzeConversion(signals: Signal[]): Promise<ConversionResult> {
  let phase2In20d = 0;
  let phase2In40d = 0;
  let phase2In60d = 0;
  let phase4Count = 0;

  const byPrevPhase: Record<string, { count: number; phase2In60d: number }> = {};

  const maxWindow = LOOKAHEAD_WINDOWS[LOOKAHEAD_WINDOWS.length - 1];
  const futurePhaseMap = await batchGetFuturePhases(signals, maxWindow);

  for (const signal of signals) {
    const key = `${signal.symbol}::${signal.date}`;
    const futurePhases = futurePhaseMap.get(key) ?? [];

    const prevKey = signal.prev_phase == null ? "null" : String(signal.prev_phase);
    if (byPrevPhase[prevKey] == null) {
      byPrevPhase[prevKey] = { count: 0, phase2In60d: 0 };
    }
    byPrevPhase[prevKey].count += 1;

    let hitPhase2 = false;
    let hitPhase4 = false;

    for (let i = 0; i < futurePhases.length; i++) {
      const dayIndex = i + 1; // 1-based trading day offset
      const phase = futurePhases[i].phase;

      if (phase === 2 && !hitPhase2) {
        hitPhase2 = true;
        if (dayIndex <= LOOKAHEAD_WINDOWS[0]) phase2In20d += 1;
        if (dayIndex <= LOOKAHEAD_WINDOWS[1]) phase2In40d += 1;
        if (dayIndex <= LOOKAHEAD_WINDOWS[2]) phase2In60d += 1;
        byPrevPhase[prevKey].phase2In60d += 1;
        break; // 첫 Phase 2 진입만 카운트
      }

      if (phase === 4 && !hitPhase2) {
        hitPhase4 = true;
      }
    }

    // Phase 2 없이 Phase 4에 도달한 경우만 false positive
    if (!hitPhase2 && hitPhase4) {
      phase4Count += 1;
    }

  }

  const total = signals.length;

  const byPrevPhaseResult: Record<string, { count: number; conversionRate60d: number }> = {};
  for (const [key, val] of Object.entries(byPrevPhase)) {
    byPrevPhaseResult[key] = {
      count: val.count,
      conversionRate60d: pct(val.phase2In60d, val.count),
    };
  }

  return {
    totalSignals: total,
    conversionRate20d: pct(phase2In20d, total),
    conversionRate40d: pct(phase2In40d, total),
    conversionRate60d: pct(phase2In60d, total),
    falsePositiveRate: pct(phase4Count, total),
    phase2In20d,
    phase2In40d,
    phase2In60d,
    phase4Count,
    byPrevPhase: byPrevPhaseResult,
  };
}

// --- Main ---

async function main() {
  console.log("=== Phase 1 후기 → Phase 2 전환율 검증 ===\n");

  // 1. 데이터 기간 자동 감지
  const { rows: rangeRows } = await pool.query<{ min_date: string; max_date: string }>(
    "SELECT min(date) AS min_date, max(date) AS max_date FROM stock_phases",
  );
  const dataRange = rangeRows[0];
  if (dataRange == null || dataRange.min_date == null || dataRange.max_date == null) {
    console.error("stock_phases 테이블에 데이터가 없습니다.");
    await pool.end();
    process.exit(1);
  }

  console.log(`데이터 기간: ${dataRange.min_date} ~ ${dataRange.max_date}`);

  // 2. 검증 기간 설정: max_date - 3개월 이전의 시그널만 대상
  const maxDate = new Date(dataRange.max_date);
  const cutoffDate = new Date(maxDate);
  cutoffDate.setMonth(cutoffDate.getMonth() - MONTHS_BUFFER);
  const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);

  const validationFrom = dataRange.min_date;
  const validationTo = cutoffDateStr;

  console.log(`검증 기간: ${validationFrom} ~ ${validationTo} (이후 ${MONTHS_BUFFER}개월 사후 데이터 확보)\n`);

  // 3. Phase 1 후기 시그널 수집 — 수정 후 (prev_phase 필터 있음)
  console.log("시그널 수집 중 (수정 후: prev_phase = 1 or NULL)...");
  const { rows: signalsWithFilter } = await pool.query<{
    symbol: string;
    date: string;
    rs_score: number;
    ma150_slope: string;
    vol_ratio: string;
    prev_phase: number | null;
  }>(
    `SELECT symbol, date, rs_score, ma150_slope::text, vol_ratio::text, prev_phase
     FROM stock_phases
     WHERE phase = 1
       AND (prev_phase IS NULL OR prev_phase = 1)
       AND ma150_slope::numeric > -0.001
       AND rs_score >= 20
       AND COALESCE(vol_ratio::numeric, 0) >= 1.2
       AND date >= $1
       AND date <= $2
     ORDER BY date, symbol`,
    [validationFrom, validationTo],
  );

  const withFilterSignals: Signal[] = signalsWithFilter.map((r) => ({
    symbol: r.symbol,
    date: r.date,
    rs_score: r.rs_score,
    ma150_slope: Number(r.ma150_slope),
    vol_ratio: Number(r.vol_ratio),
    prev_phase: r.prev_phase,
  }));

  console.log(`  → ${withFilterSignals.length}건 수집`);

  // 4. Phase 1 후기 시그널 수집 — 수정 전 (prev_phase 필터 없음)
  console.log("시그널 수집 중 (수정 전: prev_phase 필터 없음)...");
  const { rows: signalsWithoutFilter } = await pool.query<{
    symbol: string;
    date: string;
    rs_score: number;
    ma150_slope: string;
    vol_ratio: string;
    prev_phase: number | null;
  }>(
    `SELECT symbol, date, rs_score, ma150_slope::text, vol_ratio::text, prev_phase
     FROM stock_phases
     WHERE phase = 1
       AND ma150_slope::numeric > -0.001
       AND rs_score >= 20
       AND COALESCE(vol_ratio::numeric, 0) >= 1.2
       AND date >= $1
       AND date <= $2
     ORDER BY date, symbol`,
    [validationFrom, validationTo],
  );

  const withoutFilterSignals: Signal[] = signalsWithoutFilter.map((r) => ({
    symbol: r.symbol,
    date: r.date,
    rs_score: r.rs_score,
    ma150_slope: Number(r.ma150_slope),
    vol_ratio: Number(r.vol_ratio),
    prev_phase: r.prev_phase,
  }));

  console.log(`  → ${withoutFilterSignals.length}건 수집\n`);

  // 5. 전환율 분석
  console.log("전환율 분석 중 (수정 후)... 시간이 걸릴 수 있습니다.");
  const withFilterResult = await analyzeConversion(withFilterSignals);

  console.log("전환율 분석 중 (수정 전)...");
  const withoutFilterResult = await analyzeConversion(withoutFilterSignals);

  // 6. 콘솔 출력
  console.log("\n" + "=".repeat(60));
  console.log("=== Phase 1 후기 → Phase 2 전환율 검증 결과 ===");
  console.log("=".repeat(60));
  console.log(`검증 기간: ${validationFrom} ~ ${validationTo}`);
  console.log(`데이터 기간: ${dataRange.min_date} ~ ${dataRange.max_date}`);

  console.log("\n--- 수정 후 (prev_phase = 1 or NULL만) ---");
  printResult(withFilterResult);

  console.log("\n--- 수정 전 (prev_phase 필터 없음) ---");
  printResult(withoutFilterResult);

  // 7. 버그 수정 효과
  const removedFalsePositives = withoutFilterResult.totalSignals - withFilterResult.totalSignals;
  console.log("\n--- 버그 수정 효과 ---");
  console.log(`제거된 false positive: ${removedFalsePositives}건`);
  console.log(
    `전환율 개선 (60d): ${withoutFilterResult.conversionRate60d}% → ${withFilterResult.conversionRate60d}%`,
  );

  // 8. prev_phase 분포
  console.log("\n--- prev_phase 별 전환율 (수정 후) ---");
  for (const [key, val] of Object.entries(withFilterResult.byPrevPhase)) {
    console.log(`  prev_phase=${key}: ${val.count}건, 60d 전환율=${val.conversionRate60d}%`);
  }

  console.log("\n--- prev_phase 별 전환율 (수정 전) ---");
  for (const [key, val] of Object.entries(withoutFilterResult.byPrevPhase)) {
    console.log(`  prev_phase=${key}: ${val.count}건, 60d 전환율=${val.conversionRate60d}%`);
  }

  // 9. JSON 저장
  const output: ValidationOutput = {
    generatedAt: new Date().toISOString(),
    validationPeriod: { from: validationFrom, to: validationTo },
    dataRange: { from: dataRange.min_date, to: dataRange.max_date },
    withFilter: {
      totalSignals: withFilterResult.totalSignals,
      conversionRate20d: withFilterResult.conversionRate20d,
      conversionRate40d: withFilterResult.conversionRate40d,
      conversionRate60d: withFilterResult.conversionRate60d,
      falsePositiveRate: withFilterResult.falsePositiveRate,
      phase2In20d: withFilterResult.phase2In20d,
      phase2In40d: withFilterResult.phase2In40d,
      phase2In60d: withFilterResult.phase2In60d,
      phase4Count: withFilterResult.phase4Count,
      byPrevPhase: withFilterResult.byPrevPhase,
    },
    withoutFilter: {
      totalSignals: withoutFilterResult.totalSignals,
      conversionRate20d: withoutFilterResult.conversionRate20d,
      conversionRate40d: withoutFilterResult.conversionRate40d,
      conversionRate60d: withoutFilterResult.conversionRate60d,
      falsePositiveRate: withoutFilterResult.falsePositiveRate,
      phase2In20d: withoutFilterResult.phase2In20d,
      phase2In40d: withoutFilterResult.phase2In40d,
      phase2In60d: withoutFilterResult.phase2In60d,
      phase4Count: withoutFilterResult.phase4Count,
      byPrevPhase: withoutFilterResult.byPrevPhase,
    },
  };

  const outputPath = "data/review-feedback/tool-validation-phase1-late.json";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n결과 저장: ${outputPath}`);

  await pool.end();
}

function printResult(result: ConversionResult): void {
  console.log(`총 시그널: ${result.totalSignals}건`);
  console.log(
    `20일 내 Phase 2 전환: ${result.phase2In20d}건 (${result.conversionRate20d}%)`,
  );
  console.log(
    `40일 내 Phase 2 전환: ${result.phase2In40d}건 (${result.conversionRate40d}%)`,
  );
  console.log(
    `60일 내 Phase 2 전환: ${result.phase2In60d}건 (${result.conversionRate60d}%)`,
  );
  console.log(
    `Phase 4 하락 (false negative): ${result.phase4Count}건 (${result.falsePositiveRate}%)`,
  );
}

main().catch((err) => {
  console.error("검증 스크립트 실행 실패:", err);
  pool.end().finally(() => process.exit(1));
});
