/**
 * IssueCreator — GitHub 이슈 생성 + 라벨링
 *
 * gh CLI로 P1/P2/P3 + strategic-review 라벨을 붙여 이슈를 생성한다.
 * 이슈 제목 포맷: [strategic-review/{focus}] {title}
 */

import type { Insight, IssueCreationResult } from "./types.js";
import { gh } from "./ghClient.js";

/** 1일 최대 이슈 생성 수 — 노이즈 방지 */
const MAX_ISSUES_PER_RUN = 3;

/**
 * 이슈 제목 생성
 * 포맷: [strategic-review/{focus}] {title}
 */
export function buildIssueTitle(insight: Insight): string {
  return `[strategic-review/${insight.focus}] ${insight.title}`;
}

/**
 * 이슈 본문 생성 — 우선순위, 리뷰어, 생성 날짜 메타데이터 포함
 */
function buildIssueBody(insight: Insight): string {
  const today = new Date().toISOString().split("T")[0];
  return `## 전략 인사이트

${insight.body}

---

**생성**: strategic-review 자동 리뷰 (${today})
**우선순위**: ${insight.priority}
**리뷰어**: ${insight.reviewerName}
`;
}

/**
 * 단일 인사이트를 GitHub 이슈로 생성
 */
async function createIssue(
  insight: Insight,
): Promise<IssueCreationResult> {
  const title = buildIssueTitle(insight);
  const body = buildIssueBody(insight);
  const labels = [insight.priority, "strategic-review"];

  const url = await gh([
    "issue",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--label",
    labels.join(","),
  ]);

  // URL에서 이슈 번호 추출 — 마지막 숫자 세그먼트
  const parsed = parseInt(url.split("/").at(-1) ?? "", 10);
  const issueNumber = Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed;

  return {
    issueNumber,
    url,
    title,
  };
}

/**
 * 인사이트 목록을 GitHub 이슈로 생성
 *
 * P1 → P2 → P3 순으로 처리.
 * 1일 최대 MAX_ISSUES_PER_RUN건 제한.
 */
export async function createIssues(
  insights: Insight[],
): Promise<IssueCreationResult[]> {
  // 우선순위 순 정렬 (P1 > P2 > P3)
  const sorted = [...insights].sort((a, b) => {
    const order: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
    return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
  });

  const limited = sorted.slice(0, MAX_ISSUES_PER_RUN);
  const results: IssueCreationResult[] = [];

  for (const insight of limited) {
    const result = await createIssue(insight);
    results.push(result);
  }

  return results;
}
