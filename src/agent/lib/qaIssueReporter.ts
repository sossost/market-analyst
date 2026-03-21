// ---------------------------------------------------------------------------
// qaIssueReporter.ts — QA warn/block 결과를 GitHub 이슈로 자동 생성한다.
//
// 이슈 생성 실패는 비블로킹 (try-catch 격리). 에이전트 발송은 계속 진행.
// DRY_RUN=1 환경변수로 실제 이슈 생성 없이 로그만 출력.
// ---------------------------------------------------------------------------

import { exec } from "node:child_process";
import { logger } from "@/lib/logger";
import type { DailyQAResult } from "../dailyQA";
import type { DebateQAResult } from "../debateQA";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LABEL_REPORT_FEEDBACK = "report-feedback";
const LABEL_P1_HIGH = "P1: high";
const LABEL_P2_MEDIUM = "P2: medium";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QAType = "daily" | "debate";

// ---------------------------------------------------------------------------
// Issue body builder
// ---------------------------------------------------------------------------

function buildIssueBody(
  result: DailyQAResult | DebateQAResult,
  reportDate: string,
  qaType: QAType,
): string {
  const typeLabel = qaType === "daily" ? "일간 리포트" : "투자 브리핑";
  const severityLabel = result.severity === "block" ? "BLOCK" : "WARN";

  const mismatchLines = result.mismatches
    .map((m) => `- **${m.field}**: 리포트 \`${m.actual}\` / DB 실측 \`${m.expected}\` (severity: ${m.severity})`)
    .join("\n");

  return [
    `## QA 자동 감지 — ${typeLabel} 데이터 정합성 이상`,
    "",
    `- **날짜**: ${reportDate}`,
    `- **QA 타입**: ${typeLabel}`,
    `- **심각도**: ${severityLabel}`,
    `- **검증 항목 수**: ${result.checkedItems}`,
    `- **불일치 건수**: ${result.mismatches.length}`,
    "",
    "## 불일치 목록",
    "",
    mismatchLines.length > 0 ? mismatchLines : "_불일치 없음_",
    "",
    "## 대응 가이드",
    "",
    severityLabel === "BLOCK"
      ? "- 섹터 오분류 또는 Phase 2 비율 10pp+ 차이 감지. ETL 파이프라인 및 리포트 생성 로직 점검 필요."
      : "- 경미한 수치 불일치. 리포트 재확인 및 ETL 데이터 검토 권장.",
    "",
    `_자동 생성: qaIssueReporter | ${result.checkedAt}_`,
  ].join("\n");
}

export function buildIssueTitle(
  reportDate: string,
  qaType: QAType,
  severity: string,
): string {
  const typeLabel = qaType === "daily" ? "일간 QA" : "토론 QA";
  const severityLabel = severity === "block" ? "[BLOCK]" : "[WARN]";
  return `${severityLabel} ${typeLabel} 데이터 정합성 이상 — ${reportDate}`;
}

// ---------------------------------------------------------------------------
// Issue creation — exec을 콜백 기반으로 직접 래핑 (테스트 가능성 확보)
// ---------------------------------------------------------------------------

function execCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, _stderr) => {
      if (error != null) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function createGitHubIssue(
  title: string,
  body: string,
  labels: string[],
): Promise<void> {
  const isDryRun = process.env["DRY_RUN"] === "1" || process.env["VALIDATE_DRY_RUN"] === "1";

  if (isDryRun) {
    logger.info("QAIssueReporter", `DRY_RUN: 이슈 생성 스킵 — title: "${title}"`);
    return;
  }

  const labelArgs = labels.map((l) => `--label "${l}"`).join(" ");
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedBody = body.replace(/"/g, '\\"').replace(/\n/g, "\\n");

  const command = `gh issue create --title "${escapedTitle}" --body "${escapedBody}" ${labelArgs}`;

  const stdout = await execCommand(command);
  const issueUrl = stdout.trim();
  logger.info("QAIssueReporter", `이슈 생성 완료: ${issueUrl}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * QA 결과가 warn 이상이면 GitHub 이슈를 생성한다.
 *
 * - severity 'ok': 아무것도 하지 않음
 * - severity 'warn': P2: medium 라벨로 이슈 생성
 * - severity 'block': P1: high 라벨로 이슈 생성
 * - 이슈 생성 실패는 비블로킹 (logger.warn만 출력)
 */
export async function reportQAIssue(
  result: DailyQAResult | DebateQAResult,
  reportDate: string,
  qaType: QAType,
): Promise<void> {
  if (result.severity === "ok") {
    return;
  }

  try {
    const priorityLabel = result.severity === "block" ? LABEL_P1_HIGH : LABEL_P2_MEDIUM;
    const labels = [LABEL_REPORT_FEEDBACK, priorityLabel];
    const title = buildIssueTitle(reportDate, qaType, result.severity);
    const body = buildIssueBody(result, reportDate, qaType);

    await createGitHubIssue(title, body, labels);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("QAIssueReporter", `이슈 생성 실패 (비블로킹): ${reason}`);
  }
}
