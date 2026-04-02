/**
 * 애널리스트(에이전트)별 thesis 적중률 집계.
 * 순수 로직 — DB 의존 없이 테스트 가능.
 */

// ── Types ──

export interface ThesisRow {
  agentPersona: string;
  confidence: string; // 'low' | 'medium' | 'high'
  consensusLevel: string;
  status: string; // 'ACTIVE' | 'CONFIRMED' | 'INVALIDATED' | 'EXPIRED'
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

// ── Pure Functions ──

/**
 * theses 배열을 받아서 애널리스트별 통계 생성.
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
    const confirmed = rows.filter((r) => r.status === "CONFIRMED").length;
    const invalidated = rows.filter((r) => r.status === "INVALIDATED").length;
    const expired = rows.filter((r) => r.status === "EXPIRED").length;
    const active = rows.filter((r) => r.status === "ACTIVE").length;
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
      const confConfirmed = confRows.filter(
        (r) => r.status === "CONFIRMED",
      ).length;
      const confInvalidated = confRows.filter(
        (r) => r.status === "INVALIDATED",
      ).length;
      const confExpired = confRows.filter(
        (r) => r.status === "EXPIRED",
      ).length;
      const confResolved = confConfirmed + confInvalidated + confExpired;

      byConfidence[conf] = {
        total: confRows.length,
        confirmed: confConfirmed,
        invalidated: confInvalidated,
        expired: confExpired,
        hitRate: confResolved > 0 ? confConfirmed / confResolved : 0,
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
