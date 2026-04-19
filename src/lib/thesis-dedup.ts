/**
 * Thesis 검증 조건 중복 보정 (#911).
 *
 * 동일 검증 조건(verificationMetric + targetCondition)을 공유하는 thesis가
 * 하나의 데이터 포인트로 동시에 CONFIRMED/INVALIDATED될 때,
 * N건을 1건으로 카운트하여 적중률 인플레이션을 방지한다.
 */

import { normalizeMetricKey } from "@/lib/normalize-metric";

// ── Types ──

export interface ThesisForDedup {
  verificationMetric: string | null;
  targetCondition: string | null;
  status: string; // CONFIRMED | INVALIDATED | EXPIRED | ACTIVE
}

export interface DedupedCounts {
  confirmed: number;
  invalidated: number;
  expired: number;
}

// ── Core ──

/**
 * 검증 조건 정규화 키를 생성한다.
 * normalizeMetricKey(verificationMetric) + 정규화된 targetCondition을 결합.
 * metric 또는 condition이 null/undefined/empty이면 sentinel 키를 사용 (dedup 불가).
 */
export function buildConditionKey(
  metric: string | null | undefined,
  condition: string | null | undefined,
): string {
  if (metric == null || metric.trim() === "") {
    return `__no_metric__::${condition ?? "__no_condition__"}`;
  }
  const normalizedMetric = normalizeMetricKey(metric);
  if (condition == null) {
    return `${normalizedMetric}::__no_condition__`;
  }
  const normalizedCondition = condition
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${normalizedMetric}::${normalizedCondition}`;
}

/** 상태 우선순위: CONFIRMED > INVALIDATED > EXPIRED */
const STATUS_PRIORITY: Record<string, number> = {
  CONFIRMED: 3,
  INVALIDATED: 2,
  EXPIRED: 1,
};

/**
 * 동일 검증 조건 그룹의 대표 상태를 결정한다.
 * 그룹 내 thesis 중 하나라도 CONFIRMED이면 CONFIRMED.
 * CONFIRMED 없으면 INVALIDATED, 그것도 없으면 EXPIRED.
 */
function resolveGroupStatus(statuses: string[]): string {
  let best = statuses[0];
  for (let i = 1; i < statuses.length; i++) {
    if ((STATUS_PRIORITY[statuses[i]] ?? 0) > (STATUS_PRIORITY[best] ?? 0)) {
      best = statuses[i];
    }
  }
  return best;
}

/**
 * 해결된 thesis 배열에서 동일 검증 조건 중복을 보정한 카운트를 반환한다.
 * ACTIVE thesis는 무시한다.
 *
 * @example
 * // 8건의 "Technology RS > 50" CONFIRMED + 1건의 다른 조건 INVALIDATED
 * getDedupedCounts(theses) // { confirmed: 1, invalidated: 1, expired: 0 }
 */
export function getDedupedCounts(theses: ThesisForDedup[]): DedupedCounts {
  const groups = new Map<string, string[]>();

  for (const t of theses) {
    if (t.status === "ACTIVE") continue;

    const key = buildConditionKey(t.verificationMetric, t.targetCondition);
    const existing = groups.get(key);
    if (existing == null) {
      groups.set(key, [t.status]);
    } else {
      existing.push(t.status);
    }
  }

  let confirmed = 0;
  let invalidated = 0;
  let expired = 0;

  for (const statuses of groups.values()) {
    const resolved = resolveGroupStatus(statuses);
    if (resolved === "CONFIRMED") confirmed++;
    else if (resolved === "INVALIDATED") invalidated++;
    else expired++;
  }

  return { confirmed, invalidated, expired };
}

/**
 * 동일 검증 조건을 공유하는 thesis를 그룹화하고,
 * 각 그룹에서 대표 1건만 남긴다.
 * 대표 상태는 resolveGroupStatus 우선순위에 따른다.
 *
 * 반환 배열의 각 원소는 원본 thesis 객체 (대표).
 */
export function deduplicateTheses<T extends ThesisForDedup>(theses: T[]): T[] {
  const groups = new Map<string, { representative: T; bestPriority: number }>();

  for (const t of theses) {
    if (t.status === "ACTIVE") continue;

    const key = buildConditionKey(t.verificationMetric, t.targetCondition);
    const priority = STATUS_PRIORITY[t.status] ?? 0;
    const existing = groups.get(key);

    if (existing == null) {
      groups.set(key, { representative: t, bestPriority: priority });
    } else if (priority > existing.bestPriority) {
      groups.set(key, { representative: t, bestPriority: priority });
    }
  }

  return Array.from(groups.values()).map((g) => g.representative);
}

/**
 * thesis ID 배열에서 동일 조건 중복을 보정한 hit/miss 카운트를 반환한다.
 * promote-learnings의 updateLearningStats 등에서 사용.
 */
export function getDedupedHitMiss(
  sourceIds: number[],
  thesisById: Map<number, ThesisForDedup & { id: number }>,
): { hits: number; misses: number } {
  const conditionGroups = new Map<string, string>();

  for (const id of sourceIds) {
    const t = thesisById.get(id);
    if (t == null) continue;
    if (t.status !== "CONFIRMED" && t.status !== "INVALIDATED") continue;

    const key = buildConditionKey(t.verificationMetric, t.targetCondition);
    const existing = conditionGroups.get(key);

    if (existing == null) {
      conditionGroups.set(key, t.status);
    } else if (
      t.status === "CONFIRMED" &&
      existing !== "CONFIRMED"
    ) {
      conditionGroups.set(key, "CONFIRMED");
    }
  }

  let hits = 0;
  let misses = 0;
  for (const status of conditionGroups.values()) {
    if (status === "CONFIRMED") hits++;
    else misses++;
  }

  return { hits, misses };
}
