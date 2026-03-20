/**
 * confidenceCalibrator — Thesis confidence 캘리브레이션 분석.
 *
 * confidence(low/medium/high) vs 실제 적중률 비교:
 * - 캘리브레이션 곡선 데이터 생성
 * - ECE(Expected Calibration Error) 산출
 * - 프롬프트 주입용 보정 피드백 생성
 */
import { db } from "../../db/client.js";
import { theses } from "../../db/schema/analyst.js";
import { sql, inArray } from "drizzle-orm";
import { logger } from "../logger.js";
import type { Confidence } from "../../types/debate.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface CalibrationBin {
  confidence: Confidence;
  /** 해당 구간의 기대 적중률 (시스템이 부여한 의미) */
  expectedRate: number;
  /** 실제 적중률 */
  actualRate: number | null;
  confirmed: number;
  invalidated: number;
  total: number;
  /** 과신(+) / 과소확신(-) 정도. null = 데이터 부족 */
  gap: number | null;
}

export interface CalibrationResult {
  bins: CalibrationBin[];
  /** Expected Calibration Error — 가중 평균 |expected - actual| */
  ece: number | null;
  totalResolved: number;
  /** 데이터 충분성 — 최소 20건 해소 */
  hasSufficientData: boolean;
}

/**
 * confidence 레벨별 기대 적중률.
 * "high"라고 표시하면 약 80% 적중을 기대하는 것이 합리적.
 * 이 값은 ECE 산출의 기준이 된다.
 */
const EXPECTED_RATES: Record<Confidence, number> = {
  low: 0.4,
  medium: 0.6,
  high: 0.8,
};

const MIN_TOTAL_RESOLVED = 20;

// ─── Core Query ─────────────────────────────────────────────────────────────────

/**
 * confidence별 CONFIRMED/INVALIDATED 수를 집계한다.
 * thesisStore.getConfidenceHitRates()와 유사하지만 CalibrationBin 형태로 반환.
 */
export async function calcCalibrationBins(): Promise<CalibrationBin[]> {
  const rows = await db
    .select({
      confidence: theses.confidence,
      confirmed: sql<number>`count(*) filter (where ${theses.status} = 'CONFIRMED')::int`,
      invalidated: sql<number>`count(*) filter (where ${theses.status} = 'INVALIDATED')::int`,
    })
    .from(theses)
    .where(inArray(theses.status, ["CONFIRMED", "INVALIDATED"]))
    .groupBy(theses.confidence);

  return buildBinsFromRows(rows);
}

/**
 * DB 결과를 CalibrationBin[] 으로 변환한다.
 * 모든 confidence 레벨(low/medium/high)이 결과에 포함되도록 보장.
 */
export function buildBinsFromRows(
  rows: Array<{ confidence: string; confirmed: number; invalidated: number }>,
): CalibrationBin[] {
  const byConfidence = new Map(
    rows.map((r) => [r.confidence, r]),
  );

  const confidenceLevels: Confidence[] = ["low", "medium", "high"];

  return confidenceLevels.map((conf) => {
    const row = byConfidence.get(conf);
    const confirmed = row?.confirmed ?? 0;
    const invalidated = row?.invalidated ?? 0;
    const total = confirmed + invalidated;
    const expectedRate = EXPECTED_RATES[conf];
    const actualRate = total > 0 ? confirmed / total : null;
    const gap = actualRate != null ? expectedRate - actualRate : null;

    return {
      confidence: conf,
      expectedRate,
      actualRate,
      confirmed,
      invalidated,
      total,
      gap,
    };
  });
}

/**
 * ECE(Expected Calibration Error) 산출.
 * ECE = Σ (n_bin / n_total) × |expected_rate - actual_rate|
 *
 * 목표: < 0.15 (잘 캘리브레이션된 시스템)
 */
export function calcECE(bins: CalibrationBin[]): number | null {
  const totalResolved = bins.reduce((sum, b) => sum + b.total, 0);
  if (totalResolved === 0) return null;

  let weightedError = 0;
  for (const bin of bins) {
    if (bin.actualRate == null) continue;
    const weight = bin.total / totalResolved;
    const error = Math.abs(bin.expectedRate - bin.actualRate);
    weightedError += weight * error;
  }

  return Number(weightedError.toFixed(4));
}

/**
 * 전체 캘리브레이션 결과를 생성한다.
 */
export async function getCalibrationResult(): Promise<CalibrationResult> {
  const bins = await calcCalibrationBins();
  const totalResolved = bins.reduce((sum, b) => sum + b.total, 0);
  const ece = calcECE(bins);
  const hasSufficientData = totalResolved >= MIN_TOTAL_RESOLVED;

  logger.info(
    "Calibration",
    `캘리브레이션 분석: ${totalResolved}건 해소, ECE=${ece ?? "N/A"}, 충분=${hasSufficientData}`,
  );

  return { bins, ece, totalResolved, hasSufficientData };
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────────

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "LOW",
  medium: "MED",
  high: "HIGH",
};

/**
 * 캘리브레이션 결과를 프롬프트 주입용 마크다운으로 변환한다.
 *
 * 데이터 부족 시 빈 문자열 반환 — 프롬프트에 노이즈를 주입하지 않는다.
 */
export function formatCalibrationForPrompt(result: CalibrationResult): string {
  if (!result.hasSufficientData) {
    return "";
  }

  const lines: string[] = ["## Thesis Confidence 캘리브레이션", ""];

  // ECE 요약
  if (result.ece != null) {
    const ecePercent = (result.ece * 100).toFixed(1);
    const quality = result.ece < 0.1 ? "양호" : result.ece < 0.15 ? "보통" : "보정 필요";
    lines.push(`**ECE(Expected Calibration Error):** ${ecePercent}% (${quality})`, "");
  }

  // 캘리브레이션 테이블
  lines.push("| Confidence | 기대 적중률 | 실제 적중률 | 건수 | 편차 |");
  lines.push("|------------|-----------|-----------|------|------|");

  for (const bin of result.bins) {
    const label = CONFIDENCE_LABEL[bin.confidence];
    const expected = `${(bin.expectedRate * 100).toFixed(0)}%`;
    const actual = bin.actualRate != null ? `${(bin.actualRate * 100).toFixed(0)}%` : "-";
    const gapStr = formatGap(bin.gap);
    lines.push(`| ${label} | ${expected} | ${actual} | ${bin.total} | ${gapStr} |`);
  }

  // 보정 피드백
  const feedback = generateFeedback(result.bins);
  if (feedback.length > 0) {
    lines.push("", "### 보정 지침");
    for (const f of feedback) {
      lines.push(`- ${f}`);
    }
  }

  return lines.join("\n");
}

function formatGap(gap: number | null): string {
  if (gap == null) return "-";
  const sign = gap > 0 ? "과신 +" : gap < 0 ? "과소 " : "";
  return `${sign}${(Math.abs(gap) * 100).toFixed(0)}%p`;
}

/**
 * 보정 피드백 — 과신/과소확신 구간에 대한 구체적 지침.
 */
export function generateFeedback(bins: CalibrationBin[]): string[] {
  const feedback: string[] = [];
  const OVERCONFIDENCE_THRESHOLD = 0.1; // gap > 10%p → 과신
  const UNDERCONFIDENCE_THRESHOLD = -0.1; // gap < -10%p → 과소확신

  for (const bin of bins) {
    if (bin.gap == null || bin.total < 3) continue;

    const label = CONFIDENCE_LABEL[bin.confidence];
    const actualPercent = bin.actualRate != null ? `${(bin.actualRate * 100).toFixed(0)}%` : "-";

    if (bin.gap > OVERCONFIDENCE_THRESHOLD) {
      feedback.push(
        `**${label} 과신 경고**: 기대 ${(bin.expectedRate * 100).toFixed(0)}% → 실제 ${actualPercent}. ${label} confidence를 부여할 때 더 엄격한 기준을 적용하세요.`,
      );
    } else if (bin.gap < UNDERCONFIDENCE_THRESHOLD) {
      feedback.push(
        `**${label} 과소확신**: 기대 ${(bin.expectedRate * 100).toFixed(0)}% → 실제 ${actualPercent}. ${label} confidence 판단이 보수적입니다. 확신이 높은 thesis에 더 높은 등급을 부여해도 됩니다.`,
      );
    }
  }

  return feedback;
}
