/**
 * regimeThesisAnalyzer — 레짐별 thesis 성과 분석.
 *
 * market_regimes × theses 교차 분석:
 * - 레짐별 적중률 산출
 * - 레짐별 편향 감지 (bullish/bearish thesis 비율)
 * - 프롬프트 주입용 포맷 생성
 */
import { db } from "@/db/client";
import { theses, marketRegimes, type MarketRegimeType } from "@/db/schema/analyst";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface RegimeHitRate {
  regime: MarketRegimeType;
  total: number;
  confirmed: number;
  invalidated: number;
  hitRate: number; // 0.00 ~ 1.00
}

export interface RegimeBias {
  regime: MarketRegimeType;
  total: number;
  /** structural_narrative / sector_rotation / short_term_outlook 비율 */
  categoryBreakdown: Record<string, number>;
  /** persona별 thesis 수 */
  personaBreakdown: Record<string, number>;
}

export interface RegimePerformanceSummary {
  regimeHitRates: RegimeHitRate[];
  regimeBiases: RegimeBias[];
  totalResolved: number;
  overallHitRate: number;
  /** 데이터 충분성 — 레짐별 최소 5건 충족 여부 */
  hasSufficientData: boolean;
}

const RESOLVED_STATUSES = ["CONFIRMED", "INVALIDATED"] as const;
const MIN_SAMPLES_PER_REGIME = 5;

// ─── Core Queries ───────────────────────────────────────────────────────────────

/**
 * 레짐별 thesis 적중률을 산출한다.
 * thesis.debate_date = market_regimes.regime_date 기준 조인.
 * 확정된(confirmed) 레짐만 사용하여 노이즈 방지.
 */
export async function calcRegimeHitRates(): Promise<RegimeHitRate[]> {
  const rows = await db
    .select({
      regime: marketRegimes.regime,
      total: sql<number>`count(*)::int`,
      confirmed: sql<number>`sum(case when ${theses.status} = 'CONFIRMED' then 1 else 0 end)::int`,
      invalidated: sql<number>`sum(case when ${theses.status} = 'INVALIDATED' then 1 else 0 end)::int`,
    })
    .from(theses)
    .innerJoin(
      marketRegimes,
      sql`${theses.debateDate} = ${marketRegimes.regimeDate}`,
    )
    .where(
      sql`${theses.status} in ('CONFIRMED', 'INVALIDATED') and ${marketRegimes.isConfirmed} = true`,
    )
    .groupBy(marketRegimes.regime);

  return rows.map((r) => ({
    regime: r.regime as MarketRegimeType,
    total: r.total,
    confirmed: r.confirmed,
    invalidated: r.invalidated,
    hitRate: r.total > 0 ? Number((r.confirmed / r.total).toFixed(2)) : 0,
  }));
}

/**
 * 레짐별 thesis 편향을 분석한다.
 * category 및 persona 분포로 특정 레짐에서 과도한 편향이 있는지 감지.
 */
export async function calcRegimeBiases(): Promise<RegimeBias[]> {
  const rows = await db
    .select({
      regime: marketRegimes.regime,
      category: theses.category,
      persona: theses.agentPersona,
      count: sql<number>`count(*)::int`,
    })
    .from(theses)
    .innerJoin(
      marketRegimes,
      sql`${theses.debateDate} = ${marketRegimes.regimeDate}`,
    )
    .where(
      sql`${theses.status} in ('CONFIRMED', 'INVALIDATED') and ${marketRegimes.isConfirmed} = true`,
    )
    .groupBy(marketRegimes.regime, theses.category, theses.agentPersona);

  // 레짐별로 그룹핑
  const byRegime = new Map<
    string,
    { total: number; categories: Record<string, number>; personas: Record<string, number> }
  >();

  for (const row of rows) {
    const regime = row.regime as string;
    if (!byRegime.has(regime)) {
      byRegime.set(regime, { total: 0, categories: {}, personas: {} });
    }
    const entry = byRegime.get(regime)!;
    entry.total += row.count;
    entry.categories[row.category] = (entry.categories[row.category] ?? 0) + row.count;
    entry.personas[row.persona] = (entry.personas[row.persona] ?? 0) + row.count;
  }

  return Array.from(byRegime.entries()).map(([regime, data]) => ({
    regime: regime as MarketRegimeType,
    total: data.total,
    categoryBreakdown: data.categories,
    personaBreakdown: data.personas,
  }));
}

/**
 * 전체 레짐 성과 요약을 생성한다.
 */
export async function getRegimePerformanceSummary(): Promise<RegimePerformanceSummary> {
  const [hitRates, biases] = await Promise.all([
    calcRegimeHitRates(),
    calcRegimeBiases(),
  ]);

  const totalResolved = hitRates.reduce((sum, r) => sum + r.total, 0);
  const totalConfirmed = hitRates.reduce((sum, r) => sum + r.confirmed, 0);
  const overallHitRate = totalResolved > 0
    ? Number((totalConfirmed / totalResolved).toFixed(2))
    : 0;

  const hasSufficientData = hitRates.every((r) => r.total >= MIN_SAMPLES_PER_REGIME);

  logger.info(
    "RegimePerf",
    `레짐별 성과 요약: ${hitRates.length}개 레짐, ${totalResolved}건 해결, 전체 적중률 ${overallHitRate}`,
  );

  return {
    regimeHitRates: hitRates,
    regimeBiases: biases,
    totalResolved,
    overallHitRate,
    hasSufficientData,
  };
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────────

/**
 * 레짐 성과 데이터를 프롬프트 주입용 마크다운으로 변환한다.
 * 토론 프롬프트에 "현재 레짐에서 과거 적중률"을 알려주는 역할.
 */
export function formatRegimePerformanceForPrompt(
  summary: RegimePerformanceSummary,
  currentRegime?: MarketRegimeType,
): string {
  if (summary.regimeHitRates.length === 0) {
    return "";
  }

  const lines: string[] = ["## 레짐별 Thesis 적중률", ""];

  if (!summary.hasSufficientData) {
    lines.push(
      "⚠️ 일부 레짐의 샘플이 부족합니다 (레짐별 최소 5건 미달). 참고용으로만 활용하세요.",
      "",
    );
  }

  // 적중률 테이블
  lines.push("| 레짐 | 총 건수 | 적중 | 무효 | 적중률 |");
  lines.push("|------|--------|------|------|--------|");

  for (const r of summary.regimeHitRates) {
    const marker = currentRegime === r.regime ? " ◀ 현재" : "";
    lines.push(
      `| ${r.regime}${marker} | ${r.total} | ${r.confirmed} | ${r.invalidated} | ${(r.hitRate * 100).toFixed(0)}% |`,
    );
  }

  lines.push(
    "",
    `**전체 적중률:** ${(summary.overallHitRate * 100).toFixed(0)}% (${summary.totalResolved}건)`,
  );

  // 현재 레짐 강조
  if (currentRegime != null) {
    const current = summary.regimeHitRates.find((r) => r.regime === currentRegime);
    if (current != null) {
      lines.push(
        "",
        `**현재 레짐(${currentRegime})에서의 과거 적중률: ${(current.hitRate * 100).toFixed(0)}%** (${current.total}건 중 ${current.confirmed}건 적중)`,
      );

      if (current.hitRate < 0.4 && current.total >= MIN_SAMPLES_PER_REGIME) {
        lines.push(
          `⚠️ 현재 레짐에서 적중률이 낮습니다. thesis 생성 시 보수적 접근을 권장합니다.`,
        );
      }
    }
  }

  // 편향 요약 (category breakdown)
  if (summary.regimeBiases.length > 0) {
    lines.push("", "### 레짐별 카테고리 분포");
    for (const b of summary.regimeBiases) {
      const cats = Object.entries(b.categoryBreakdown)
        .map(([cat, count]) => `${cat}: ${count}건(${((count / b.total) * 100).toFixed(0)}%)`)
        .join(", ");
      lines.push(`- **${b.regime}**: ${cats}`);
    }
  }

  return lines.join("\n");
}
