/**
 * failurePatternFilter — failure_patterns 기반 추천 후보 필터 로직.
 *
 * 순수 함수만 포함하여 테스트 용이성을 보장한다.
 * scan-recommendation-candidates.ts에서 사용.
 */

import type { ActiveFailurePatternRow } from "@/db/repositories/failurePatternRepository.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BreadthDirection = "improving" | "declining" | "neutral";

export interface CandidateConditions {
  sepaGrade: string | null;
  volumeConfirmed: boolean | null;
  breadthDirection: BreadthDirection | null;
}

export interface FailurePatternMatch {
  patternName: string;
  conditions: string;
  failureRate: number;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────

/**
 * 후보 종목의 속성에서 조건 키 목록을 도출한다.
 * collect-failure-patterns.ts의 extractConditionKeys와 동일한 키 형식을 사용.
 */
export function deriveConditionKeys(conditions: CandidateConditions): string[] {
  const keys: string[] = [];

  if (conditions.breadthDirection != null) {
    keys.push(`breadth:${conditions.breadthDirection}`);
  }

  if (conditions.volumeConfirmed != null) {
    keys.push(`volume:${conditions.volumeConfirmed}`);
  }

  if (conditions.sepaGrade != null) {
    // C, F 등급을 그룹화 (collect-failure-patterns.ts와 동일)
    const gradeKey =
      conditions.sepaGrade === "C" || conditions.sepaGrade === "F"
        ? "C-F"
        : conditions.sepaGrade;
    keys.push(`sepa:${gradeKey}`);
  }

  return keys;
}

/**
 * 패턴의 conditions 문자열을 개별 조건 키로 파싱한다.
 * 예: "breadth:declining|sepa:C-F" → ["breadth:declining", "sepa:C-F"]
 */
export function parsePatternConditions(conditionsStr: string): string[] {
  return conditionsStr.split("|").filter((part) => part.length > 0);
}

/**
 * 후보 종목의 조건 키가 패턴의 모든 조건을 충족하는지 검사한다.
 * 패턴의 모든 조건 부분이 후보의 조건 키에 포함되어야 매칭.
 */
export function matchesPattern(
  candidateKeys: Set<string>,
  patternConditions: string[],
): boolean {
  if (patternConditions.length === 0) return false;
  return patternConditions.every((part) => candidateKeys.has(part));
}

/**
 * 후보 종목이 활성 실패 패턴 중 하나와 매칭되는지 검사한다.
 * 매칭되면 첫 번째 매칭 패턴 정보를 반환, 없으면 null.
 */
export function findMatchingPattern(
  candidateConditions: CandidateConditions,
  patterns: ActiveFailurePatternRow[],
): FailurePatternMatch | null {
  if (patterns.length === 0) return null;

  const candidateKeys = new Set(deriveConditionKeys(candidateConditions));
  if (candidateKeys.size === 0) return null;

  for (const pattern of patterns) {
    const patternParts = parsePatternConditions(pattern.conditions);
    if (patternParts.length === 0) continue;

    if (matchesPattern(candidateKeys, patternParts)) {
      return {
        patternName: pattern.patternName,
        conditions: pattern.conditions,
        failureRate: pattern.failureRate != null ? Number(pattern.failureRate) : 0,
      };
    }
  }

  return null;
}

/**
 * market_breadth_daily의 phase2_ratio_change로 시장 브레드스 방향을 도출한다.
 */
export function deriveBreadthDirection(
  phase2RatioChange: number | null,
): BreadthDirection | null {
  if (phase2RatioChange == null) return null;

  if (phase2RatioChange > 0) return "improving";
  if (phase2RatioChange < 0) return "declining";
  return "neutral";
}
