/**
 * Tool Error Reporter — Discord 알림 + GitHub 이슈 자동 생성.
 *
 * 모든 외부 호출은 fire-and-forget: 실패해도 에이전트 루프를 블로킹하지 않는다.
 */
import { sendDiscordError, sanitizeErrorForDiscord } from "@/lib/discord";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────
// Session-level dedup for Discord
// ────────────────────────────────────────────

const reportedErrors = new Set<string>();

function buildDedupKey(toolName: string, errorMessage: string): string {
  return `${toolName}::${errorMessage}`;
}

/** Reset dedup set — useful for testing or new sessions. */
export function resetToolErrorDedup(): void {
  reportedErrors.clear();
}

// ────────────────────────────────────────────
// GitHub issue creation
// ────────────────────────────────────────────

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_FETCH_TIMEOUT_MS = 15_000;
const ISSUE_TITLE_MAX_LENGTH = 100;

function getGitHubConfig(): { token: string; owner: string; repo: string } | null {
  const token = process.env["GITHUB_TOKEN"];
  if (token == null || token === "") {
    return null;
  }

  const repository = process.env["GITHUB_REPOSITORY"] ?? "sossost/market-analyst";
  const [owner, repo] = repository.split("/");
  if (owner == null || repo == null) {
    return null;
  }

  return { token, owner, repo };
}

function buildIssueTitle(toolName: string, errorMessage: string): string {
  const sanitized = sanitizeErrorForDiscord(errorMessage);
  const prefix = `[Tool Error] ${toolName}: `;
  const maxMsgLength = ISSUE_TITLE_MAX_LENGTH - prefix.length;
  const truncated =
    sanitized.length > maxMsgLength
      ? `${sanitized.slice(0, maxMsgLength - 3)}...`
      : sanitized;
  return `${prefix}${truncated}`;
}

function buildIssueBody(
  toolName: string,
  errorMessage: string,
  input: Record<string, unknown>,
): string {
  const sanitizedError = sanitizeErrorForDiscord(errorMessage);
  const sanitizedInput = sanitizeErrorForDiscord(JSON.stringify(input, null, 2));
  const date = new Date().toISOString().split("T")[0];

  return `## 도구 에러 자동 감지

| 항목 | 값 |
|------|-----|
| **도구** | \`${toolName}\` |
| **날짜** | ${date} |
| **에러** | ${sanitizedError} |

### 입력 파라미터
\`\`\`json
${sanitizedInput}
\`\`\`

### 자동 생성 안내
이 이슈는 에이전트 도구 에러 감지 파이프라인에 의해 자동 생성되었습니다.
동일 에러가 반복 발생하면 이 이슈에 코멘트가 추가될 수 있습니다.`;
}

async function findExistingIssue(
  config: { token: string; owner: string; repo: string },
  title: string,
): Promise<number | null> {
  const escapedTitle = title.replace(/"/g, '\\"');
  const query = encodeURIComponent(`repo:${config.owner}/${config.repo} is:issue is:open in:title "${escapedTitle}"`);
  const url = `${GITHUB_API_BASE}/search/issues?q=${query}&per_page=1`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });

  if (response.ok === false) {
    return null;
  }

  const data = (await response.json()) as { total_count: number; items: Array<{ number: number }> };
  if (data.total_count > 0 && data.items[0] != null) {
    return data.items[0].number;
  }

  return null;
}

async function createGitHubIssue(
  config: { token: string; owner: string; repo: string },
  title: string,
  body: string,
): Promise<number | null> {
  const url = `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/issues`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      labels: ["bug", "P1: high"],
    }),
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });

  if (response.ok === false) {
    const text = await response.text().catch(() => "");
    logger.error("ToolErrorReporter", `GitHub issue creation failed (${response.status}): ${text}`);
    return null;
  }

  const data = (await response.json()) as { number: number };
  return data.number;
}

async function reportToGitHub(
  toolName: string,
  errorMessage: string,
  input: Record<string, unknown>,
): Promise<void> {
  const config = getGitHubConfig();
  if (config == null) {
    logger.warn("ToolErrorReporter", "GITHUB_TOKEN not set, skipping GitHub issue creation");
    return;
  }

  const title = buildIssueTitle(toolName, errorMessage);

  const existingIssueNumber = await findExistingIssue(config, title);
  if (existingIssueNumber != null) {
    logger.info("ToolErrorReporter", `Duplicate issue exists (#${existingIssueNumber}), skipping creation`);
    return;
  }

  const body = buildIssueBody(toolName, errorMessage, input);
  const issueNumber = await createGitHubIssue(config, title, body);

  if (issueNumber != null) {
    logger.info("ToolErrorReporter", `GitHub issue #${issueNumber} created for ${toolName} error`);
  }
}

// ────────────────────────────────────────────
// Discord notification
// ────────────────────────────────────────────

async function reportToDiscord(
  toolName: string,
  errorMessage: string,
  input: Record<string, unknown>,
): Promise<void> {
  const sanitizedInput = sanitizeErrorForDiscord(JSON.stringify(input));
  const date = new Date().toISOString().split("T")[0];

  const message = [
    `🔧 도구 에러 감지`,
    `• 도구: ${toolName}`,
    `• 에러: ${sanitizeErrorForDiscord(errorMessage)}`,
    `• 입력: ${sanitizedInput}`,
    `• 날짜: ${date}`,
  ].join("\n");

  await sendDiscordError(message);
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Report a tool error via Discord + GitHub issue.
 * Fire-and-forget: never throws, never blocks the agent loop.
 */
export async function reportToolError(
  toolName: string,
  errorMessage: string,
  input: Record<string, unknown>,
): Promise<void> {
  const dedupKey = buildDedupKey(toolName, errorMessage);

  if (reportedErrors.has(dedupKey)) {
    logger.debug("ToolErrorReporter", `Dedup: ${toolName} error already reported in this session`);
    return;
  }

  reportedErrors.add(dedupKey);

  // Fire-and-forget: both run in parallel, neither blocks
  const discordPromise = reportToDiscord(toolName, errorMessage, input).catch((err) => {
    logger.error("ToolErrorReporter", `Discord notification failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const githubPromise = reportToGitHub(toolName, errorMessage, input).catch((err) => {
    logger.error("ToolErrorReporter", `GitHub issue creation failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  await Promise.allSettled([discordPromise, githubPromise]);
}

// ────────────────────────────────────────────
// Exported for testing
// ────────────────────────────────────────────

export const _testing = {
  buildDedupKey,
  buildIssueTitle,
  buildIssueBody,
  getGitHubConfig,
  findExistingIssue,
  reportToDiscord,
  reportToGitHub,
};
