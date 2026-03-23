/**
 * confidenceCalibrator — Thesis confidence 캘리브레이션 분석.
 *
 * confidence(low/medium/high) vs 실제 적중률 비교:
 * - 캘리브레이션 곡선 데이터 생성
 * - ECE(Expected Calibration Error) 산출
 * - 프롬프트 주입용 보정 피드백 생성
 */
import { db } from "@/db/client";
import { theses } from "@/db/schema/analyst";
import { sql, eq, and, inArray, desc } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { AgentPersona, Confidence } from "@/types/debate";
import { EXPERT_PERSONAS } from "./personas.js";

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
const MIN_PERSONA_RESOLVED = 5;

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

  const confidenceLevels = Object.keys(EXPECTED_RATES) as Confidence[];

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

// ─── Per-Persona Calibration ────────────────────────────────────────────────────

/**
 * 특정 에이전트의 confidence별 CONFIRMED/INVALIDATED 수를 집계한다.
 */
export async function calcCalibrationBinsForPersona(
  persona: AgentPersona,
): Promise<CalibrationBin[]> {
  const rows = await db
    .select({
      confidence: theses.confidence,
      confirmed: sql<number>`count(*) filter (where ${theses.status} = 'CONFIRMED')::int`,
      invalidated: sql<number>`count(*) filter (where ${theses.status} = 'INVALIDATED')::int`,
    })
    .from(theses)
    .where(
      and(
        eq(theses.agentPersona, persona),
        inArray(theses.status, ["CONFIRMED", "INVALIDATED"]),
      ),
    )
    .groupBy(theses.confidence);

  return buildBinsFromRows(rows);
}

/**
 * 특정 에이전트의 캘리브레이션 결과를 생성한다.
 * per-persona는 MIN_PERSONA_RESOLVED(5건)로 충분성 판단.
 */
export async function getCalibrationResultForPersona(
  persona: AgentPersona,
): Promise<CalibrationResult> {
  const bins = await calcCalibrationBinsForPersona(persona);
  const totalResolved = bins.reduce((sum, b) => sum + b.total, 0);
  const ece = calcECE(bins);
  const hasSufficientData = totalResolved >= MIN_PERSONA_RESOLVED;

  logger.info(
    "Calibration",
    `[${persona}] 캘리브레이션: ${totalResolved}건 해소, ECE=${ece ?? "N/A"}, 충분=${hasSufficientData}`,
  );

  return { bins, ece, totalResolved, hasSufficientData };
}

/**
 * 모든 에이전트의 per-persona 캘리브레이션 컨텍스트를 생성한다.
 * Record<persona, formatted prompt string> 반환.
 */
export async function buildPerAgentCalibrationContexts(): Promise<
  Record<string, string>
> {
  const results: Record<string, string> = {};

  const entries = await Promise.all(
    EXPERT_PERSONAS.map(async (persona) => {
      try {
        const result = await getCalibrationResultForPersona(persona);
        const formatted = formatCalibrationForPrompt(result);
        if (formatted.length > 0) {
          return { persona, formatted };
        }
      } catch (err) {
        logger.warn(
          "Calibration",
          `[${persona}] 캘리브레이션 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }),
  );

  for (const entry of entries) {
    if (entry != null) {
      results[entry.persona] = entry.formatted;
    }
  }

  return results;
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

  // 전체 적중률 요약
  const totalConfirmed = result.bins.reduce((sum, b) => sum + b.confirmed, 0);
  const totalInvalidated = result.bins.reduce((sum, b) => sum + b.invalidated, 0);
  const totalResolved = totalConfirmed + totalInvalidated;
  if (totalResolved > 0) {
    const overallRate = ((totalConfirmed / totalResolved) * 100).toFixed(0);
    lines.push(`**전체 적중률:** ${overallRate}% (${totalConfirmed}/${totalResolved}건)`, "");
  }

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

// ─── Recent Failures ─────────────────────────────────────────────────────────────

export interface InvalidatedThesisRow {
  thesis: string;
  verificationMetric: string;
  targetCondition: string;
  debateDate: string;
}

const MAX_RECENT_FAILURES = 3;

/**
 * 특정 에이전트의 최근 INVALIDATED thesis를 조회한다.
 * 에이전트가 자신의 과거 실패를 인지하고 반복을 피하도록 한다.
 */
export async function loadRecentInvalidatedTheses(
  persona: AgentPersona,
  limit: number = MAX_RECENT_FAILURES,
): Promise<InvalidatedThesisRow[]> {
  const rows = await db
    .select({
      thesis: theses.thesis,
      verificationMetric: theses.verificationMetric,
      targetCondition: theses.targetCondition,
      debateDate: theses.debateDate,
    })
    .from(theses)
    .where(
      and(
        eq(theses.agentPersona, persona),
        eq(theses.status, "INVALIDATED"),
      ),
    )
    .orderBy(desc(theses.debateDate))
    .limit(limit);

  return rows;
}

/**
 * 최근 INVALIDATED thesis를 프롬프트 주입용 마크다운으로 변환한다.
 */
export function formatRecentFailuresForPrompt(
  failures: InvalidatedThesisRow[],
): string {
  if (failures.length === 0) return "";

  const lines: string[] = [
    "### 최근 INVALIDATED (실패) Thesis",
    "",
    "아래는 당신이 과거에 제출했으나 시장에 의해 **기각된** thesis입니다.",
    "동일 섹터·동일 방향의 예측을 반복하지 마세요. 실패 원인을 고려하여 새로운 thesis의 근거를 더 엄격하게 검증하세요.",
    "",
  ];

  for (const f of failures) {
    lines.push(
      `- [${f.debateDate}] "${f.thesis}" (검증: ${f.verificationMetric} ${f.targetCondition}) → **INVALIDATED**`,
    );
  }

  return lines.join("\n");
}

// ─── Enhanced Per-Agent Context ──────────────────────────────────────────────────

/**
 * 모든 에이전트의 per-persona 캘리브레이션 컨텍스트를 생성한다.
 * 기존 confidence 캘리브레이션 + 최근 실패 thesis를 포함.
 */
export async function buildEnhancedPerAgentCalibrationContexts(): Promise<
  Record<string, string>
> {
  const results: Record<string, string> = {};

  const entries = await Promise.all(
    EXPERT_PERSONAS.map(async (persona) => {
      try {
        const [calibResult, failures] = await Promise.all([
          getCalibrationResultForPersona(persona),
          loadRecentInvalidatedTheses(persona),
        ]);

        const parts: string[] = [];

        const calibFormatted = formatCalibrationForPrompt(calibResult);
        if (calibFormatted.length > 0) {
          parts.push(calibFormatted);
        }

        const failuresFormatted = formatRecentFailuresForPrompt(failures);
        if (failuresFormatted.length > 0) {
          parts.push(failuresFormatted);
        }

        if (parts.length > 0) {
          return { persona, formatted: parts.join("\n\n") };
        }
      } catch (err) {
        logger.warn(
          "Calibration",
          `[${persona}] 캘리브레이션 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }),
  );

  for (const entry of entries) {
    if (entry != null) {
      results[entry.persona] = entry.formatted;
    }
  }

  return results;
}

// ─── Moderator Performance Context ───────────────────────────────────────────────

export interface PersonaHitRate {
  persona: AgentPersona;
  confirmed: number;
  invalidated: number;
  hitRate: number | null;
}

/**
 * 모든 에이전트의 전체 적중률을 조회한다.
 */
export async function getPerAgentHitRates(): Promise<PersonaHitRate[]> {
  const rows = await db
    .select({
      agentPersona: theses.agentPersona,
      confirmed: sql<number>`count(*) filter (where ${theses.status} = 'CONFIRMED')::int`,
      invalidated: sql<number>`count(*) filter (where ${theses.status} = 'INVALIDATED')::int`,
    })
    .from(theses)
    .where(inArray(theses.status, ["CONFIRMED", "INVALIDATED"]))
    .groupBy(theses.agentPersona);

  return rows.map((r) => {
    const total = r.confirmed + r.invalidated;
    return {
      persona: r.agentPersona as AgentPersona,
      confirmed: r.confirmed,
      invalidated: r.invalidated,
      hitRate: total > 0 ? r.confirmed / total : null,
    };
  });
}

const PERSONA_LABEL_KR: Record<string, string> = {
  macro: "매크로 이코노미스트",
  tech: "테크 애널리스트",
  geopolitics: "지정학 전략가",
  sentiment: "시장 심리 분석가",
};

const LOW_HIT_RATE_THRESHOLD = 0.5;

/**
 * 모더레이터에게 전달할 에이전트별 적중률 컨텍스트를 생성한다.
 * 저적중 에이전트의 의견을 할인하도록 지시한다.
 */
export async function buildModeratorPerformanceContext(): Promise<string> {
  try {
    const hitRates = await getPerAgentHitRates();
    if (hitRates.length === 0) return "";

    return formatModeratorPerformanceContext(hitRates);
  } catch (err) {
    logger.warn(
      "Calibration",
      `모더레이터 성과 컨텍스트 생성 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

/**
 * 에이전트 적중률 배열을 모더레이터 프롬프트용 마크다운으로 변환한다.
 * 순수 함수 — 테스트 용이.
 */
export function formatModeratorPerformanceContext(
  hitRates: PersonaHitRate[],
): string {
  if (hitRates.length === 0) return "";

  // 적중률 내림차순 정렬
  const sorted = [...hitRates].sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0));

  const lines: string[] = [
    "## 에이전트별 Thesis 적중률",
    "",
    "아래는 각 분석가의 과거 thesis 적중률(CONFIRMED / (CONFIRMED + INVALIDATED))입니다.",
    "**합의 도출 시 적중률이 높은 분석가의 의견에 더 큰 비중을 두세요.**",
    "적중률 50% 미만 분석가의 단독 의견은 다른 분석가의 근거로 보강되지 않는 한 합의에 반영하지 마세요.",
    "",
    "| 분석가 | 적중 | 기각 | 적중률 | 신뢰도 |",
    "|--------|------|------|--------|--------|",
  ];

  for (const hr of sorted) {
    const label = PERSONA_LABEL_KR[hr.persona] ?? hr.persona;
    const total = hr.confirmed + hr.invalidated;
    const rateStr = hr.hitRate != null ? `${(hr.hitRate * 100).toFixed(0)}%` : "-";
    const reliability =
      total < 3 ? "데이터 부족" :
      hr.hitRate != null && hr.hitRate < LOW_HIT_RATE_THRESHOLD ? "⚠️ 저신뢰" :
      "정상";
    lines.push(`| ${label} | ${hr.confirmed} | ${hr.invalidated} | ${rateStr} | ${reliability} |`);
  }

  return lines.join("\n");
}
