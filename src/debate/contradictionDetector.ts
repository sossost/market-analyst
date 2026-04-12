/**
 * Cross-Thesis Contradiction Detector (#752).
 *
 * Round3 synthesis 후 추출된 thesis 배열에서 같은 target entity에 대해
 * 방향성이 상반되는 thesis 쌍을 탐지하고, lower consensus 쪽에 플래그를 부착한다.
 *
 * LLM을 사용하지 않는 순수 규칙 기반 탐지.
 * consensusVerifier.ts와 동일한 패턴: thesis[] in → flagged thesis[] out.
 */

import { logger } from "@/lib/logger";
import type { Thesis, ConsensusLevel } from "@/types/debate";

// ─── Direction Classification ─────────────────────────────────────────────────

export type ThesisDirection = "bullish" | "bearish" | "neutral";

/** targetCondition에서 bullish 방향성을 나타내는 패턴 (specific first) */
const BULLISH_CONDITION_PATTERNS: RegExp[] = [
  />=\s*[\d.]+/,    // ">= N" — more specific, must come first
  />\s*[\d.]+/,     // "> N"
];

/** targetCondition에서 bearish 방향성을 나타내는 패턴 (specific first) */
const BEARISH_CONDITION_PATTERNS: RegExp[] = [
  /<=\s*[\d.]+/,    // "<= N" — more specific, must come first
  /<\s*[\d.]+/,     // "< N"
];

/** thesis 텍스트에서 bullish 방향성을 나타내는 키워드 */
const BULLISH_TEXT_KEYWORDS = /(?:상승|유지|강화|확대|가속|성장|수혜|호조|주도|선도|지속|Phase\s*2(?!\s*이탈))/;

/** thesis 텍스트에서 bearish 방향성을 나타내는 키워드 */
const BEARISH_TEXT_KEYWORDS = /(?:하락|약화|축소|둔화|과열|위축|감소|악화|조정|이탈|붕괴|하락\s*전환)/;

/**
 * thesis의 방향성을 규칙 기반으로 분류한다.
 *
 * 1차: targetCondition의 비교 연산자 (> → bullish, < → bearish)
 * 2차: thesis 텍스트의 방향성 키워드
 * 판정 불가 시 neutral (모순 판정에서 제외)
 */
export function classifyDirection(thesis: Thesis): ThesisDirection {
  const condition = thesis.targetCondition;

  // 1차: targetCondition 비교 연산자 기반 판정
  const isBullishCondition = BULLISH_CONDITION_PATTERNS.some((p) => p.test(condition));
  const isBearishCondition = BEARISH_CONDITION_PATTERNS.some((p) => p.test(condition));

  if (isBullishCondition && !isBearishCondition) return "bullish";
  if (isBearishCondition && !isBullishCondition) return "bearish";

  // 2차: thesis 텍스트 키워드 기반 판정
  const text = thesis.thesis;
  const hasBullishText = BULLISH_TEXT_KEYWORDS.test(text);
  const hasBearishText = BEARISH_TEXT_KEYWORDS.test(text);

  if (hasBullishText && !hasBearishText) return "bullish";
  if (hasBearishText && !hasBullishText) return "bearish";

  return "neutral";
}

// ─── Target Entity Extraction & Matching ──────────────────────────────────────

/**
 * verificationMetric에서 정규화된 target entity를 추출한다.
 * "Technology RS", "Technology sector RS" → "technology"
 * "S&P 500", "SPX" → "s&p 500"
 * "VIX" → "vix"
 */
export function normalizeMetric(metric: string): string {
  return metric
    .toLowerCase()
    .replace(/\bsector\b|\brs\b|\bindex\b|\bratio\b|\bscore\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 두 thesis가 같은 target entity를 참조하는지 판정한다.
 *
 * 1차: normalizeMetric(verificationMetric)이 동일하거나 한쪽이 다른 쪽을 포함
 * 2차: beneficiarySectors 교집합 존재
 */
export function shareTargetEntity(a: Thesis, b: Thesis): boolean {
  // 1차: verificationMetric 비교
  const metricA = normalizeMetric(a.verificationMetric);
  const metricB = normalizeMetric(b.verificationMetric);

  if (metricA.length > 0 && metricB.length > 0) {
    if (metricA === metricB) return true;
    if (metricA.includes(metricB) || metricB.includes(metricA)) return true;
  }

  // 2차: beneficiarySectors 교집합
  const sectorsA = new Set((a.beneficiarySectors ?? []).map((s) => s.toLowerCase()));
  const sectorsB = (b.beneficiarySectors ?? []).map((s) => s.toLowerCase());

  if (sectorsA.size > 0 && sectorsB.length > 0) {
    for (const s of sectorsB) {
      if (sectorsA.has(s)) return true;
    }
  }

  return false;
}

// ─── Consensus Score Parsing ──────────────────────────────────────────────────

function parseConsensusScore(level: ConsensusLevel): number {
  const score = parseInt(level.split("/")[0], 10);
  if (Number.isNaN(score)) return 0;
  return score;
}

// ─── Contradiction Detection ──────────────────────────────────────────────────

export interface ContradictionPair {
  /** 우선(유지) thesis 인덱스 */
  keptIndex: number;
  /** 강등(flagged) thesis 인덱스 */
  flaggedIndex: number;
  /** 공유 target entity 설명 */
  sharedTarget: string;
  /** kept thesis 방향 */
  keptDirection: ThesisDirection;
  /** flagged thesis 방향 */
  flaggedDirection: ThesisDirection;
}

export interface ContradictionDetectionResult {
  /** flag가 부착된 thesis 배열 */
  theses: Thesis[];
  /** 탐지된 모순 쌍 */
  contradictions: ContradictionPair[];
}

/**
 * thesis 배열에서 cross-thesis 모순을 탐지하고 lower consensus 쪽에 flag를 부착한다.
 *
 * 모순 해소 규칙:
 * 1. consensusScore 비교 → 낮은 쪽에 flag
 * 2. 동일 → 배열 앞쪽(먼저 추출된)에 flag (최신 = 후순위 우선)
 *
 * @returns flagged thesis 배열 + 탐지된 모순 쌍 목록
 */
export function detectContradictions(theses: Thesis[]): ContradictionDetectionResult {
  if (theses.length < 2) {
    return { theses, contradictions: [] };
  }

  // 1단계: 각 thesis의 방향성 분류
  const directions = theses.map((t) => classifyDirection(t));

  // neutral은 모순 판정 대상에서 제외
  const contradictions: ContradictionPair[] = [];
  const flaggedIndices = new Set<number>();

  // 2단계: 모든 쌍을 검사
  for (let i = 0; i < theses.length; i++) {
    if (directions[i] === "neutral") continue;

    for (let j = i + 1; j < theses.length; j++) {
      if (directions[j] === "neutral") continue;

      // 같은 방향이면 모순 아님
      if (directions[i] === directions[j]) continue;

      // target entity가 다르면 모순 아님
      if (!shareTargetEntity(theses[i], theses[j])) continue;

      // 모순 발견 — 어느 쪽을 강등할지 결정
      const scoreI = parseConsensusScore(theses[i].consensusLevel);
      const scoreJ = parseConsensusScore(theses[j].consensusLevel);

      let flaggedIdx: number;
      let keptIdx: number;

      if (scoreI < scoreJ) {
        flaggedIdx = i;
        keptIdx = j;
      } else if (scoreJ < scoreI) {
        flaggedIdx = j;
        keptIdx = i;
      } else {
        // 동일 consensus → 앞쪽(먼저 추출된 = 덜 최신)을 강등
        flaggedIdx = i;
        keptIdx = j;
      }

      flaggedIndices.add(flaggedIdx);

      const metricTarget = normalizeMetric(theses[flaggedIdx].verificationMetric);
      const intersectingSector = (theses[flaggedIdx].beneficiarySectors ?? [])
        .find((s) =>
          (theses[keptIdx].beneficiarySectors ?? [])
            .map((x) => x.toLowerCase())
            .includes(s.toLowerCase()),
        );
      const sharedTarget = metricTarget || intersectingSector || "unknown";

      contradictions.push({
        keptIndex: keptIdx,
        flaggedIndex: flaggedIdx,
        sharedTarget,
        keptDirection: directions[keptIdx],
        flaggedDirection: directions[flaggedIdx],
      });
    }
  }

  // 3단계: flagged thesis에 contradictionDetected = true 부착
  const result = theses.map((t, idx) => {
    if (flaggedIndices.has(idx)) {
      return { ...t, contradictionDetected: true };
    }
    return t;
  });

  if (contradictions.length > 0) {
    logger.warn(
      "ContradictionDetector",
      `모순 thesis ${contradictions.length}쌍 탐지 (${flaggedIndices.size}건 flagged)`,
    );
    for (const c of contradictions) {
      logger.info(
        "ContradictionDetector",
        `모순: "${theses[c.keptIndex].thesis.slice(0, 40)}..." (${c.keptDirection}) vs ` +
        `"${theses[c.flaggedIndex].thesis.slice(0, 40)}..." (${c.flaggedDirection}) — ` +
        `target: ${c.sharedTarget}`,
      );
    }
  }

  return { theses: result, contradictions };
}
