/**
 * Deduplicator — 기존 GitHub 이슈 중복 체크
 *
 * gh CLI로 strategic-review 라벨의 오픈 이슈를 조회하고,
 * Jaccard 유사도 0.6 이상이면 중복으로 판정한다.
 */

import type { Insight } from "./types.js";
import { gh } from "./ghClient.js";

const JACCARD_THRESHOLD = 0.6;
const DUPLICATE_LABEL = "strategic-review";

interface ExistingIssue {
  number: number;
  title: string;
  createdAt: string;
}

/**
 * 문자열을 토큰 집합으로 변환 (단어 단위 분리)
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

/**
 * Jaccard 유사도 계산
 * |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;

  const intersection = new Set([...a].filter((token) => b.has(token)));
  const union = new Set([...a, ...b]);

  return intersection.size / union.size;
}

/**
 * strategic-review 라벨이 붙은 오픈 이슈 전체 조회
 */
async function fetchExistingStrategicIssues(): Promise<ExistingIssue[]> {
  const raw = await gh([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    DUPLICATE_LABEL,
    "--json",
    "number,title,createdAt",
    "--limit",
    "200",
  ]);

  if (raw === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item): ExistingIssue[] => {
    if (
      item == null ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>)["number"] !== "number" ||
      typeof (item as Record<string, unknown>)["title"] !== "string" ||
      typeof (item as Record<string, unknown>)["createdAt"] !== "string"
    ) {
      return [];
    }
    const obj = item as Record<string, unknown>;
    return [
      {
        number: obj["number"] as number,
        title: obj["title"] as string,
        createdAt: obj["createdAt"] as string,
      },
    ];
  });
}

/**
 * 인사이트가 기존 오픈 이슈와 중복인지 판정
 *
 * 중복 기준:
 * 1. 제목 Jaccard 유사도 0.6 이상
 * 2. 같은 파일/함수 언급 + 같은 문제 유형
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateIssueNumber?: number;
  similarityScore?: number;
}

export async function checkDuplicate(
  insight: Insight,
  existingIssues: ExistingIssue[],
): Promise<DuplicateCheckResult> {
  const insightTokens = tokenize(insight.title);

  for (const existing of existingIssues) {
    const existingTokens = tokenize(existing.title);
    const similarity = jaccardSimilarity(insightTokens, existingTokens);

    if (similarity >= JACCARD_THRESHOLD) {
      return {
        isDuplicate: true,
        duplicateIssueNumber: existing.number,
        similarityScore: similarity,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * 인사이트 목록에서 중복을 제거한 목록과 스킵된 제목 반환
 */
export async function deduplicateInsights(insights: Insight[]): Promise<{
  unique: Insight[];
  skipped: string[];
}> {
  const existingIssues = await fetchExistingStrategicIssues();

  const unique: Insight[] = [];
  const skipped: string[] = [];

  for (const insight of insights) {
    const result = await checkDuplicate(insight, existingIssues);

    if (result.isDuplicate) {
      skipped.push(
        `"${insight.title}" (기존 이슈 #${result.duplicateIssueNumber}, 유사도: ${((result.similarityScore ?? 0) * 100).toFixed(0)}%)`,
      );
    } else {
      unique.push(insight);
    }
  }

  return { unique, skipped };
}
