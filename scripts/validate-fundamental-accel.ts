import "dotenv/config";
import fs from "node:fs";
import { pool } from "@/db/client";
import { computeYoYGrowths, isAccelerating } from "@/agent/tools/getFundamentalAcceleration";

// --- Types ---

interface QuarterRow {
  symbol: string;
  period_end_date: string;
  eps_diluted: string | null;
  revenue: string | null;
  net_income: string | null;
  sector: string | null;
  industry: string | null;
}

interface PhaseRow {
  symbol: string;
  date: string;
  phase: number;
  rs_score: number | null;
}

interface AccelStock {
  symbol: string;
  signalDate: string;
  isEpsAccelerating: boolean;
  isRevenueAccelerating: boolean;
}

interface PhaseSnapshot {
  phase: number;
  rsScore: number | null;
}

interface ValidationResult {
  generatedAt: string;
  totalAccelerating: number;
  byType: { epsOnly: number; revenueOnly: number; both: number };
  phaseAtSignal: { phase1: number; phase2: number; phase3: number; phase4: number };
  phase2Rate3m: number;
  phase2Rate6m: number;
  avgRsChange3m: number;
  avgRsChange6m: number;
  phase1Intersection: {
    count: number;
    phase2Rate3m: number;
    phase2Rate6m: number;
    avgRsChange3m: number;
  };
}

// --- Constants ---

const MIN_QUARTERS_FOR_YOY = 7; // 4(YoY) + 3(가속 판단)
const MONTHS_3 = 90;
const MONTHS_6 = 180;

// --- Helpers ---

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(1));
}

// --- Main ---

async function main() {
  console.log("=== 펀더멘탈 가속 종목 사후 성과 검증 ===\n");

  // 1. 최근 2년 분기 실적 로드 (Phase/RS 필터 없이 — 사후 검증이므로 전체 대상)
  const { rows: quarterRows } = await pool.query<QuarterRow>(
    `SELECT
       qf.symbol,
       qf.period_end_date,
       qf.eps_diluted::text,
       qf.revenue::text,
       qf.net_income::text,
       s.sector,
       s.industry
     FROM quarterly_financials qf
     JOIN symbols s ON qf.symbol = s.symbol
     WHERE qf.period_end_date >= (CURRENT_DATE - INTERVAL '2 years')::text
     ORDER BY qf.symbol, qf.period_end_date DESC`,
  );

  // 종목별 그룹화
  const bySymbol = new Map<string, QuarterRow[]>();
  for (const row of quarterRows) {
    const arr = bySymbol.get(row.symbol) ?? [];
    arr.push(row);
    bySymbol.set(row.symbol, arr);
  }

  // 2. 가속 종목 식별
  const accelStocks: AccelStock[] = [];

  for (const [symbol, quarters] of bySymbol) {
    if (quarters.length < MIN_QUARTERS_FOR_YOY) continue;

    const epsGrowths = computeYoYGrowths(quarters, "eps_diluted");
    const revenueGrowths = computeYoYGrowths(quarters, "revenue");

    const epsAccel = isAccelerating(epsGrowths);
    const revAccel = isAccelerating(revenueGrowths);

    if (!epsAccel && !revAccel) continue;

    // 포착 시점 = 가장 최근 분기 실적 발표일
    const signalDate = quarters[0].period_end_date;

    accelStocks.push({
      symbol,
      signalDate,
      isEpsAccelerating: epsAccel,
      isRevenueAccelerating: revAccel,
    });
  }

  if (accelStocks.length === 0) {
    console.log("가속 종목이 없습니다.");
    await pool.end();
    return;
  }

  // 가속 유형 분류
  const epsOnly = accelStocks.filter((s) => s.isEpsAccelerating && !s.isRevenueAccelerating).length;
  const revOnly = accelStocks.filter((s) => !s.isEpsAccelerating && s.isRevenueAccelerating).length;
  const both = accelStocks.filter((s) => s.isEpsAccelerating && s.isRevenueAccelerating).length;

  // 3. Phase/RS 조회 — 포착 시점, +3개월, +6개월
  const symbols = accelStocks.map((s) => s.symbol);
  const { rows: allPhases } = await pool.query<PhaseRow>(
    `SELECT symbol, date, phase, rs_score
     FROM stock_phases
     WHERE symbol = ANY($1)
     ORDER BY symbol, date`,
    [symbols],
  );

  // symbol → date → PhaseRow 인덱싱
  const phaseIndex = new Map<string, Map<string, PhaseRow>>();
  for (const row of allPhases) {
    let dateMap = phaseIndex.get(row.symbol);
    if (dateMap == null) {
      dateMap = new Map();
      phaseIndex.set(row.symbol, dateMap);
    }
    dateMap.set(row.date, row);
  }

  /**
   * 특정 symbol의 targetDate 이후 가장 가까운 Phase 데이터를 찾는다.
   * 최대 30일 범위 내에서 탐색.
   */
  function findNearestPhase(symbol: string, targetDate: string): PhaseSnapshot | null {
    const dateMap = phaseIndex.get(symbol);
    if (dateMap == null) return null;

    const MAX_SEARCH_DAYS = 30;
    for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset++) {
      const d = addDays(targetDate, offset);
      const row = dateMap.get(d);
      if (row != null) {
        return { phase: row.phase, rsScore: row.rs_score };
      }
    }
    return null;
  }

  // 4. 성과 집계
  const phaseAtSignal = { phase1: 0, phase2: 0, phase3: 0, phase4: 0 };

  interface Outcome {
    signalPhase: number;
    signalRs: number | null;
    phase3m: number | null;
    rs3m: number | null;
    phase6m: number | null;
    rs6m: number | null;
  }

  const outcomes: Outcome[] = [];

  for (const stock of accelStocks) {
    const atSignal = findNearestPhase(stock.symbol, stock.signalDate);
    if (atSignal == null) continue;

    const phaseKey = `phase${atSignal.phase}` as keyof typeof phaseAtSignal;
    if (phaseKey in phaseAtSignal) {
      phaseAtSignal[phaseKey]++;
    }

    const target3m = addDays(stock.signalDate, MONTHS_3);
    const target6m = addDays(stock.signalDate, MONTHS_6);

    const at3m = findNearestPhase(stock.symbol, target3m);
    const at6m = findNearestPhase(stock.symbol, target6m);

    outcomes.push({
      signalPhase: atSignal.phase,
      signalRs: atSignal.rsScore,
      phase3m: at3m?.phase ?? null,
      rs3m: at3m?.rsScore ?? null,
      phase6m: at6m?.phase ?? null,
      rs6m: at6m?.rsScore ?? null,
    });
  }

  // --- 전체 통계 ---

  const with3m = outcomes.filter((o) => o.phase3m != null);
  const with6m = outcomes.filter((o) => o.phase6m != null);

  const phase2OrBetter3m = with3m.filter((o) => o.phase3m === 2).length;
  const phase34_3m = with3m.filter((o) => o.phase3m === 3 || o.phase3m === 4).length;
  const phase2OrBetter6m = with6m.filter((o) => o.phase6m === 2).length;

  const rsChanges3m = with3m
    .filter((o) => o.signalRs != null && o.rs3m != null)
    .map((o) => o.rs3m! - o.signalRs!);
  const rsChanges6m = with6m
    .filter((o) => o.signalRs != null && o.rs6m != null)
    .map((o) => o.rs6m! - o.signalRs!);

  // --- Phase 1 교집합 ---

  const phase1Outcomes = outcomes.filter((o) => o.signalPhase === 1);
  const phase1With3m = phase1Outcomes.filter((o) => o.phase3m != null);
  const phase1With6m = phase1Outcomes.filter((o) => o.phase6m != null);

  const p1Phase2_3m = phase1With3m.filter((o) => o.phase3m === 2).length;
  const p1Phase2_6m = phase1With6m.filter((o) => o.phase6m === 2).length;
  const p1RsChanges3m = phase1With3m
    .filter((o) => o.signalRs != null && o.rs3m != null)
    .map((o) => o.rs3m! - o.signalRs!);

  // --- 출력 ---

  const totalWithPhase = outcomes.length;

  console.log(`총 가속 종목: ${accelStocks.length}건`);
  console.log(`  - EPS 가속만: ${epsOnly}건`);
  console.log(`  - 매출 가속만: ${revOnly}건`);
  console.log(`  - 양쪽 가속: ${both}건`);

  console.log(`\n포착 시점 Phase 분포:`);
  console.log(`  Phase 1: ${phaseAtSignal.phase1}건 (${pct(phaseAtSignal.phase1, totalWithPhase)}%)`);
  console.log(`  Phase 2: ${phaseAtSignal.phase2}건 (${pct(phaseAtSignal.phase2, totalWithPhase)}%)`);
  console.log(`  Phase 3: ${phaseAtSignal.phase3}건 (${pct(phaseAtSignal.phase3, totalWithPhase)}%)`);
  console.log(`  Phase 4: ${phaseAtSignal.phase4}건 (${pct(phaseAtSignal.phase4, totalWithPhase)}%)`);

  console.log(`\n3개월 후 Phase 변화 (데이터 ${with3m.length}건):`);
  console.log(`  Phase 2 유지/진입: ${pct(phase2OrBetter3m, with3m.length)}%`);
  console.log(`  Phase 3/4 전환: ${pct(phase34_3m, with3m.length)}%`);

  console.log(`\n6개월 후 Phase 변화 (데이터 ${with6m.length}건):`);
  console.log(`  Phase 2 유지/진입: ${pct(phase2OrBetter6m, with6m.length)}%`);

  console.log(`\n평균 RS 변화:`);
  console.log(`  3개월 후: ${rsChanges3m.length > 0 ? (avg(rsChanges3m) > 0 ? "+" : "") + avg(rsChanges3m) : "N/A"}`);
  console.log(`  6개월 후: ${rsChanges6m.length > 0 ? (avg(rsChanges6m) > 0 ? "+" : "") + avg(rsChanges6m) : "N/A"}`);

  console.log(`\n--- Phase 1 + 가속 교집합 (핵심 지표) ---`);
  console.log(`대상: ${phase1Outcomes.length}건`);
  console.log(`3개월 내 Phase 2 전환: ${pct(p1Phase2_3m, phase1With3m.length)}%`);
  console.log(`6개월 내 Phase 2 전환: ${pct(p1Phase2_6m, phase1With6m.length)}%`);
  if (p1RsChanges3m.length > 0) {
    const avgVal = avg(p1RsChanges3m);
    console.log(`평균 RS 변화 (3개월): ${avgVal > 0 ? "+" : ""}${avgVal}`);
  }

  // --- JSON 저장 ---

  const result: ValidationResult = {
    generatedAt: new Date().toISOString(),
    totalAccelerating: accelStocks.length,
    byType: { epsOnly, revenueOnly: revOnly, both },
    phaseAtSignal,
    phase2Rate3m: pct(phase2OrBetter3m, with3m.length),
    phase2Rate6m: pct(phase2OrBetter6m, with6m.length),
    avgRsChange3m: avg(rsChanges3m),
    avgRsChange6m: avg(rsChanges6m),
    phase1Intersection: {
      count: phase1Outcomes.length,
      phase2Rate3m: pct(p1Phase2_3m, phase1With3m.length),
      phase2Rate6m: pct(p1Phase2_6m, phase1With6m.length),
      avgRsChange3m: avg(p1RsChanges3m),
    },
  };

  const outDir = "data/review-feedback";
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = `${outDir}/tool-validation-fundamental-accel.json`;
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nJSON 저장: ${outPath}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
