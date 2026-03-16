/**
 * gh CLI 공유 클라이언트
 *
 * deduplicator, issueCreator 등 gh CLI를 사용하는 모듈에서 공통으로 사용.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REPO = "sossost/market-analyst";

/**
 * gh CLI 실행 헬퍼
 */
export async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    timeout: 30_000,
    env: { ...process.env, GH_REPO: REPO },
  });
  return stdout.trim();
}
