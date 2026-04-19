/**
 * 애널리스트(에이전트)별 thesis 적중률 집계.
 * 순수 로직 — DB 의존 없이 테스트 가능.
 *
 * #911: 동일 검증 조건(verificationMetric + targetCondition) 중복 보정 적용.
 * verificationMetric/targetCondition이 있으면 중복 보정, 없으면 기존 동작 유지.
 */

import { getDedupedCounts, type ThesisForDedup } from "@/lib/thesis-dedup";

// ── Types ──

export interface ThesisRow {
  agentPersona: string;
  confidence: string; // 'low' | 'medium' | 'high'
  consensusLevel: string;
  status: string; // 'ACTIVE' | 'CONFIRMED' | 'INVALIDATED' | 'EXPIRED'
  /** #911: 중복 보정에 필요. 없으면 보정 미적용 (하위 호환). */
  verificationMetric?: string;
  /** #911: 중복 보정에 필요. 없으면 보정 미적용 (하위 호환). */
  targetCondition?: string;
}

export interface ConfidenceBreakdown {
  total: number;
  confirmed: number;
  invalidated: number;
  expired: number;
  hitRate: number;
}

export interface AgentStats {
  persona: string;
  total: number;
  confirmed: number;
  invalidated: number;
  expired: number;
  active: number;
  hitRate: number; // confirmed / (confirmed + invalidated + expired)
  byConfidence: Record<string, ConfidenceBreakdown>;
}

// ── Internal ──

/** 중복 보정 가능 여부 확인 — 모든 행에 필수 필드가 있어야 함 */
function canDedup(rows: ThesisRow[]): rows is (ThesisRow & Required<Pick<ThesisRow, "verificationMetric" | "targetCondition">>)[] {
  return rows.length > 0 && rows.every(
    (r) => r.verificationMetric != null && r.targetCondition != null,
  );
}

/** 중복 보정된 카운트를 반환 (보정 불가 시 단순 카운트) */
function countResolved(rows: ThesisRow[]): { confirmed: number; invalidated: number; expired: number } {
  if (canDedup(rows)) {
    return getDedupedCounts(rows as ThesisForDedup[]);
  }
  return {
    confirmed: rows.filter((r) => r.status === "CONFIRMED").length,
    invalidated: rows.filter((r) => r.status === "INVALIDATED").length,
    expired: rows.filter((r) => r.status === "EXPIRED").length,
  };
}

// ── Pure Functions ──

/**
 * theses 배열을 받아서 애널리스트별 통계 생성.
 * #911: verificationMetric/targetCondition이 있으면 동일 조건 중복 보정 적용.
 */
export function calculateAgentPerformance(
  theses: ThesisRow[],
): AgentStats[] {
  if (theses.length === 0) return [];

  const grouped = new Map<string, ThesisRow[]>();

  for (const thesis of theses) {
    const persona = thesis.agentPersona;
    const existing = grouped.get(persona);
    if (existing == null) {
      grouped.set(persona, [thesis]);
    } else {
      existing.push(thesis);
    }
  }

  const stats: AgentStats[] = [];

  for (const [persona, rows] of grouped) {
    const active = rows.filter((r) => r.status === "ACTIVE").length;
    const { confirmed, invalidated, expired } = countResolved(rows);
    const resolved = confirmed + invalidated + expired;
    const hitRate = resolved > 0 ? confirmed / resolved : 0;

    // Confidence breakdown
    const byConfidence: Record<string, ConfidenceBreakdown> = {};
    const confidenceGroups = new Map<string, ThesisRow[]>();

    for (const row of rows) {
      const conf = row.confidence;
      const existing = confidenceGroups.get(conf);
      if (existing == null) {
        confidenceGroups.set(conf, [row]);
      } else {
        existing.push(row);
      }
    }

    for (const [conf, confRows] of confidenceGroups) {
      const confCounts = countResolved(confRows);
      const confResolved = confCounts.confirmed + confCounts.invalidated + confCounts.expired;

      byConfidence[conf] = {
        total: confRows.length,
        confirmed: confCounts.confirmed,
        invalidated: confCounts.invalidated,
        expired: confCounts.expired,
        hitRate: confResolved > 0 ? confCounts.confirmed / confResolved : 0,
      };
    }

    stats.push({
      persona,
      total: rows.length,
      confirmed,
      invalidated,
      expired,
      active,
      hitRate,
      byConfidence,
    });
  }

  // 적중률 내림차순 정렬
  stats.sort((a, b) => b.hitRate - a.hitRate);

  return stats;
}

/**
 * 전체 성과 요약 (한 줄).
 * resolved (confirmed + invalidated + expired)가 있는 애널리스트만 비교.
 */
export function summarizePerformance(stats: AgentStats[]): string {
  if (stats.length === 0) return "집계 대상 thesis 없음";

  const withResolved = stats.filter(
    (s) => s.confirmed + s.invalidated + s.expired > 0,
  );

  if (withResolved.length === 0) {
    return "아직 검증 완료된 thesis 없음 (모두 ACTIVE 또는 EXPIRED)";
  }

  const best = withResolved.reduce((a, b) =>
    a.hitRate > b.hitRate ? a : b,
  );
  const worst = withResolved.reduce((a, b) =>
    a.hitRate < b.hitRate ? a : b,
  );

  const formatRate = (rate: number) => `${(rate * 100).toFixed(0)}%`;

  if (best.persona === worst.persona) {
    return `애널리스트 ${withResolved.length}명 중 검증 완료: ${best.persona} (${formatRate(best.hitRate)})`;
  }

  return `최우수: ${best.persona} (${formatRate(best.hitRate)}), 최저: ${worst.persona} (${formatRate(worst.hitRate)})`;
}
