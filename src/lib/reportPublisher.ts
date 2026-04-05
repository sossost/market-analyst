import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "@/lib/logger";

const TAG = "ReportPublisher";
const PAGES_REPO = "sossost/market-reports";
const PAGES_BASE_URL = "https://sossost.github.io/market-reports";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ReportType = "daily" | "weekly";

/**
 * HTML 리포트를 GitHub Pages 레포에 push하여 퍼블릭 URL을 생성한다.
 *
 * - 실패 시 null 반환 (fail-open — Gist fallback이 동작해야 함)
 * - 성공 시 GitHub Pages URL 반환
 * - type 기본값 "daily" — 기존 일간 파이프라인 무변경
 * - type "weekly" 시 경로: weekly/{date}/index.html
 */
export async function publishHtmlReport(
  html: string,
  date: string,
  type: ReportType = "daily",
): Promise<string | null> {
  if (!DATE_PATTERN.test(date)) {
    logger.error(TAG, `잘못된 날짜 형식: ${date} — YYYY-MM-DD 필요`);
    return null;
  }

  const workDir = join(tmpdir(), `market-reports-${Date.now()}`);

  try {
    // GitHub 토큰이 있으면 URL에 포함하여 인증
    const token = process.env["GITHUB_TOKEN"];
    const repoUrl = token != null && token !== ""
      ? `https://x-access-token:${token}@github.com/${PAGES_REPO}.git`
      : `https://github.com/${PAGES_REPO}.git`;

    // 1. clone (shallow)
    await git(["clone", "--depth", "1", repoUrl, workDir]);

    // 2. write file — type에 따라 경로 분기
    const dir = join(workDir, type, date);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html, "utf-8");

    // 3. commit & push
    await git(["add", "."], workDir);

    const status = await git(["status", "--porcelain"], workDir);
    if (status.trim() === "") {
      logger.info(TAG, "변경 없음 — push 건너뜀");
      return `${PAGES_BASE_URL}/${type}/${date}/`;
    }

    await git(["-c", "user.name=Market Analyst Bot", "-c", "user.email=bot@noreply.github.com", "commit", "-m", `report(${type}): ${date}`], workDir);
    await git(["push"], workDir);

    const url = `${PAGES_BASE_URL}/${type}/${date}/`;
    logger.info(TAG, `GitHub Pages 발행 완료: ${url}`);
    return url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(TAG, `GitHub Pages 발행 실패: ${msg}`);
    return null;
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch { /* 정리 실패는 무시 */ }
  }
}

function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error != null) {
        reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}
