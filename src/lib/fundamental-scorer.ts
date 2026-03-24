/**
 * Minervini SEPA 기반 펀더멘탈 스코어러.
 *
 * 정량 로직만 사용 — LLM 의존 없음.
 * 입력: 종목의 최근 8분기 실적 데이터
 * 출력: 등급 (A/B/C/F) + 개별 기준 판정
 */
import type {
  FundamentalInput,
  FundamentalScore,
  FundamentalGrade,
  SEPACriteria,
  CriteriaResult,
  QuarterlyData,
} from "../types/fundamental.js";
import { parseQuarterStr } from "./quarter-utils.js";

const EPS_GROWTH_THRESHOLD = 25; // YoY > 25%
const REVENUE_GROWTH_THRESHOLD = 25; // YoY > 25%
const MIN_QUARTERS_REQUIRED = 5; // 최소 5분기 (YoY 비교 위해)
const MIN_QUARTERS_FOR_ACCELERATION = 3;
const MIN_QUARTERS_FOR_MARGIN = 3;
const TURNAROUND_SCORE = 200; // 적자→흑자 전환 시 고정 점수
// ─── Public API ─────────────────────────────────────────────────────

export function scoreFundamentals(input: FundamentalInput): FundamentalScore {
  const { symbol, quarters } = input;

  if (quarters.length < MIN_QUARTERS_REQUIRED) {
    return makeInsufficientDataScore(symbol);
  }

  const epsGrowth = evaluateEpsGrowth(quarters);
  const revenueGrowth = evaluateRevenueGrowth(quarters);
  const epsAcceleration = evaluateEpsAcceleration(quarters);
  const marginExpansion = evaluateMarginExpansion(quarters);
  const roe = evaluateROE(quarters);

  const criteria: SEPACriteria = {
    epsGrowth,
    revenueGrowth,
    epsAcceleration,
    marginExpansion,
    roe,
  };

  const requiredMet = [epsGrowth, revenueGrowth].filter((c) => c.passed).length;
  // ROE 데이터 미확보로 등급 판정에서 제외 — epsAcceleration + marginExpansion만 카운트
  const bonusMet = [epsAcceleration, marginExpansion].filter((c) => c.passed).length;

  const grade = determineGrade(requiredMet, bonusMet);
  const totalScore = requiredMet * 30 + bonusMet * 20; // max 2×30 + 2×20 = 100
  const rankScore = calcRankScore(criteria);

  return { symbol, grade, totalScore, rankScore, requiredMet, bonusMet, criteria };
}

// ─── Pure calculation helpers (exported for unit testing) ───────────

/** YoY 성장률 (%). prior가 0 이하이면 의미 있는 산출 불가 → null */
export function calcYoYGrowth(
  current: number | null,
  prior: number | null,
): number | null {
  if (current == null || prior == null) return null;
  if (prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 100 * 100) / 100;
}

/** 적자→흑자 전환 감지. prior < 0 & current > 0이면 고정 TURNAROUND_SCORE 반환 */
export function calcTurnaroundScore(
  current: number | null,
  prior: number | null,
): number | null {
  if (current == null || prior == null) return null;
  if (prior < 0 && current > 0) return TURNAROUND_SCORE;
  return null;
}

export const calcEpsGrowthYoY = calcYoYGrowth;
export const calcRevenueGrowthYoY = calcYoYGrowth;

/**
 * newest-first YoY growth rates → 최신 분기가 이전 분기들의 평균보다 높으면 acceleration.
 * 기존 strictly monotonic 대신 완화된 기준: growthRates[0] > avg(growthRates[1:])
 */
export function checkEpsAcceleration(growthRates: number[]): boolean {
  if (growthRates.length < MIN_QUARTERS_FOR_ACCELERATION) return false;
  // growthRates[0] = latest, [1:] = prior quarters
  const priorRates = growthRates.slice(1);
  const priorAvg = priorRates.reduce((sum, r) => sum + r, 0) / priorRates.length;
  return growthRates[0] > priorAvg;
}

/** newest-first net margins → overall trend is up (allow 1 dip) */
export function checkMarginExpansion(margins: number[]): boolean {
  if (margins.length < MIN_QUARTERS_FOR_MARGIN) return false;

  // oldest-first로 변환하여 시간순 비교
  const chronological = [...margins].reverse();
  const oldest = chronological[0];
  const newest = chronological[chronological.length - 1];

  if (newest <= oldest) return false;

  let declines = 0;
  for (let i = 0; i < chronological.length - 1; i++) {
    if (chronological[i + 1] < chronological[i]) declines++;
  }

  return declines <= 1;
}

/** ROE 추정 — DB에 equity 데이터 없으므로 현재 null 반환 */
export function estimateROE(_quarters: QuarterlyData[]): number | null {
  // TODO: equity 데이터 확보 시 구현
  return null;
}

// ─── Internal evaluation functions ──────────────────────────────────

function evaluateEpsGrowth(quarters: QuarterlyData[]): CriteriaResult {
  const current = quarters[0];
  const priorYear = findYoYQuarter(quarters, 0);

  if (priorYear == null) {
    return { passed: false, value: null, detail: "데이터 부족: YoY 비교 대상 없음" };
  }

  const growth = calcEpsGrowthYoY(current.epsDiluted, priorYear.epsDiluted);

  if (growth == null) {
    // 적자→흑자 전환 감지
    const turnaround = calcTurnaroundScore(current.epsDiluted, priorYear.epsDiluted);
    if (turnaround != null) {
      return {
        passed: true,
        value: turnaround,
        detail: `EPS 흑자 전환: ${priorYear.epsDiluted} → ${current.epsDiluted} (turnaround +${turnaround})`,
      };
    }
    return { passed: false, value: null, detail: "EPS 데이터 부족" };
  }

  const passed = growth > EPS_GROWTH_THRESHOLD;
  return {
    passed,
    value: growth,
    detail: `EPS YoY ${growth > 0 ? "+" : ""}${growth}% (기준: >${EPS_GROWTH_THRESHOLD}%)`,
  };
}

function evaluateRevenueGrowth(quarters: QuarterlyData[]): CriteriaResult {
  const current = quarters[0];
  const priorYear = findYoYQuarter(quarters, 0);

  if (priorYear == null) {
    return { passed: false, value: null, detail: "데이터 부족: YoY 비교 대상 없음" };
  }

  const growth = calcRevenueGrowthYoY(current.revenue, priorYear.revenue);

  if (growth == null) {
    return { passed: false, value: null, detail: "매출 데이터 부족" };
  }

  const passed = growth > REVENUE_GROWTH_THRESHOLD;
  return {
    passed,
    value: growth,
    detail: `매출 YoY ${growth > 0 ? "+" : ""}${growth}% (기준: >${REVENUE_GROWTH_THRESHOLD}%)`,
  };
}

function evaluateEpsAcceleration(quarters: QuarterlyData[]): CriteriaResult {
  const growthRates: number[] = [];

  // 최근 3분기 각각의 YoY 성장률 계산
  for (let i = 0; i < Math.min(3, quarters.length); i++) {
    const priorYear = findYoYQuarter(quarters, i);
    if (priorYear == null) break;

    const growth = calcEpsGrowthYoY(
      quarters[i].epsDiluted,
      priorYear.epsDiluted,
    );
    if (growth == null) break;

    growthRates.push(growth);
  }

  const passed = checkEpsAcceleration(growthRates);
  // growthRates는 newest-first — 시간순(과거→현재)으로 뒤집어 표시
  const ratesStr = [...growthRates].reverse().map((r) => `${r}%`).join(" → ");
  return {
    passed,
    value: growthRates.length > 0 ? growthRates[0] : null,
    detail: growthRates.length > 0
      ? `${passed ? "EPS 가속" : "EPS 가속 미충족"}: ${ratesStr}`
      : `EPS 가속 미충족 (데이터 부족)`,
  };
}

function evaluateMarginExpansion(quarters: QuarterlyData[]): CriteriaResult {
  const margins = quarters
    .slice(0, 4)
    .map((q) => q.netMargin)
    .filter((m): m is number => m != null);

  const passed = checkMarginExpansion(margins);
  const chronologicalStr = [...margins].reverse().map((m) => `${m.toFixed(2)}%`).join(" → ");
  return {
    passed,
    value: margins.length > 0 ? margins[0] : null,
    detail: margins.length > 0
      ? `${passed ? "이익률 확대" : "이익률 확대 미충족"}: ${chronologicalStr}`
      : `이익률 확대 미충족 (데이터 부족)`,
  };
}

function evaluateROE(quarters: QuarterlyData[]): CriteriaResult {
  const roe = estimateROE(quarters);
  return {
    passed: false,
    value: roe,
    detail: "ROE 데이터 미확보 (equity 없음)",
  };
}

// ─── Grade determination ────────────────────────────────────────────

/**
 * 등급 판정 매트릭스 (exported for testing):
 *
 * | required\bonus | 0   | 1   | 2   |
 * |----------------|-----|-----|-----|
 * | 0              | F   | C   | C   |
 * | 1              | C   | B   | B   |
 * | 2              | B   | B   | A   |
 */
export function determineGrade(requiredMet: number, bonusMet: number): FundamentalGrade {
  if (requiredMet >= 2 && bonusMet >= 2) return "A";
  if (requiredMet >= 2) return "B"; // 필수 전부 충족 → 최소 B
  if (requiredMet >= 1 && bonusMet >= 1) return "B";
  if (requiredMet > 0 || bonusMet > 0) return "C";
  return "F";
}

function makeInsufficientDataScore(symbol: string): FundamentalScore {
  const empty: CriteriaResult = { passed: false, value: null, detail: "데이터 부족" };
  return {
    symbol,
    grade: "F",
    totalScore: 0,
    rankScore: 0,
    requiredMet: 0,
    bonusMet: 0,
    criteria: {
      epsGrowth: empty,
      revenueGrowth: empty,
      epsAcceleration: empty,
      marginExpansion: empty,
      roe: empty,
    },
  };
}

// ─── Rank score (A급 내 변별용) ─────────────────────────────────────

/**
 * 실적 강도 기반 랭킹 점수.
 * EPS 성장률 + 매출 성장률 + 마진 수준 가산.
 */
export function calcRankScore(criteria: SEPACriteria): number {
  let score = 0;

  // EPS 성장률 반영 (가중 40%)
  if (criteria.epsGrowth.value != null) {
    score += Math.min(criteria.epsGrowth.value, 300); // cap at 300%
  }

  // 매출 성장률 반영 (가중 30%)
  if (criteria.revenueGrowth.value != null) {
    score += Math.min(criteria.revenueGrowth.value, 300) * 0.75;
  }

  // 이익률 수준 가산 (가중 20%)
  if (criteria.marginExpansion.value != null) {
    score += Math.min(criteria.marginExpansion.value, 70) * 2;
  }

  // 가속 보너스 (10%)
  if (criteria.epsAcceleration.passed) {
    score += 50;
  }

  return Math.round(score * 100) / 100;
}

const S_GRADE_TOP_N = 3;

/**
 * A급 종목 중 rankScore 상위 N개를 S등급으로 승격.
 * 반드시 scoreFundamentals 이후, 전체 리스트에 대해 한 번 호출.
 */
export function promoteTopToS(scores: FundamentalScore[]): FundamentalScore[] {
  const aGrades = scores.filter((s) => s.grade === "A");

  if (aGrades.length === 0) return scores;

  const sorted = [...aGrades].sort((a, b) => b.rankScore - a.rankScore);
  const topSymbols = new Set(sorted.slice(0, S_GRADE_TOP_N).map((s) => s.symbol));

  return scores.map((s) =>
    topSymbols.has(s.symbol) ? { ...s, grade: "S" as FundamentalGrade } : s,
  );
}

// ─── Quarter matching ───────────────────────────────────────────────

/** quarters[idx]의 작년 동분기 찾기 — asOfQ 기반 매칭 */
function findYoYQuarter(
  quarters: QuarterlyData[],
  idx: number,
): QuarterlyData | null {
  const target = quarters[idx];
  if (target == null) return null;

  const targetQ = parseQuarterStr(target.asOfQ);
  if (targetQ == null) return null;

  const priorYear = targetQ.year - 1;
  return (
    quarters.find((q) => {
      const parsed = parseQuarterStr(q.asOfQ);
      return parsed != null && parsed.quarter === targetQ.quarter && parsed.year === priorYear;
    }) ?? null
  );
}
