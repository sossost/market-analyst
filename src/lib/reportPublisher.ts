import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "@/lib/logger";

const TAG = "ReportPublisher";
const PAGES_REPO = "sossost/market-reports";
const PAGES_BASE_URL = "https://sossost.github.io/market-reports";

/**
 * HTML 리포트를 GitHub Pages 레포에 push하여 퍼블릭 URL을 생성한다.
 *
 * - 실패 시 null 반환 (fail-open — Gist fallback이 동작해야 함)
 * - 성공 시 GitHub Pages URL 반환
 */
export async function publishHtmlReport(
  html: string,
  date: string,
): Promise<string | null> {
  const workDir = join(tmpdir(), `market-reports-${Date.now()}`);

  try {
    // 1. clone (shallow)
    await git(["clone", "--depth", "1", `https://github.com/${PAGES_REPO}.git`, workDir]);

    // 2. write file
    const dir = join(workDir, "daily", date);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html, "utf-8");

    // 3. commit & push
    await git(["add", "."], workDir);

    const status = await git(["status", "--porcelain"], workDir);
    if (status.trim() === "") {
      logger.info(TAG, "변경 없음 — push 건너뜀");
      return `${PAGES_BASE_URL}/daily/${date}/`;
    }

    await git(["commit", "-m", `report: ${date}`], workDir);
    await git(["push"], workDir);

    const url = `${PAGES_BASE_URL}/daily/${date}/`;
    logger.info(TAG, `GitHub Pages 발행 완료: ${url}`);
    return url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(TAG, `GitHub Pages 발행 실패: ${msg}`);
    return null;
  } finally {
    // cleanup
    try {
      const { rmSync } = await import("node:fs");
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
