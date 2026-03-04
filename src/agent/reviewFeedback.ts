import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewVerdict = "OK" | "REVISE" | "REJECT";

export interface ReviewFeedbackEntry {
  date: string;
  verdict: ReviewVerdict;
  feedback: string;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FEEDBACK_COUNT = 5;
const FEEDBACK_DIR = join(process.cwd(), "data", "review-feedback");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 리뷰 피드백을 JSON 파일로 저장한다.
 * 파일명: {date}.json (같은 날짜면 덮어쓰기)
 */
export function saveReviewFeedback(
  entry: ReviewFeedbackEntry,
  dir: string = FEEDBACK_DIR,
): void {
  ensureDir(dir);
  const filePath = join(dir, `${entry.date}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * 최근 N회의 피드백을 로드한다 (date 역순).
 * OK 판정은 저장하지 않으므로, 로드된 엔트리는 모두 REVISE 또는 REJECT이다.
 */
export function loadRecentFeedback(
  count: number = DEFAULT_FEEDBACK_COUNT,
  dir: string = FEEDBACK_DIR,
): ReviewFeedbackEntry[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, count);

  return files.flatMap((f) => {
    try {
      const content = readFileSync(join(dir, f), "utf-8");
      return [JSON.parse(content) as ReviewFeedbackEntry];
    } catch {
      logger.warn("ReviewFeedback", `Skipping corrupt file: ${f}`);
      return [];
    }
  });
}

/**
 * 피드백 엔트리들을 시스템 프롬프트에 주입할 텍스트로 변환한다.
 */
export function buildFeedbackPromptSection(
  entries: ReviewFeedbackEntry[],
): string {
  if (entries.length === 0) {
    return "";
  }

  const header = `## 과거 리뷰 피드백 (최근 ${entries.length}회)

아래는 이전 리포트에 대한 리뷰어의 지적사항입니다. 이번 리포트 작성 시 반드시 반영하세요.`;

  const items = entries.map((e) => {
    const issueLines = e.issues.map((issue) => `- ${issue}`).join("\n");
    return `### ${e.date} (${e.verdict})\n${e.feedback}\n${issueLines}`;
  });

  return `${header}\n\n${items.join("\n\n")}`;
}
