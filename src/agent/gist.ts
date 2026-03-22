import { logger } from "@/lib/logger";

const FETCH_TIMEOUT_MS = 15_000;
const GITHUB_API = "https://api.github.com/gists";

/**
 * LLM이 생성한 마크다운 테이블의 흔한 오류를 수정한다.
 * - 행 끝의 이중 파이프 `||` → `|`
 * - 구분선 행의 잘못된 패턴 정리
 */
function sanitizeMarkdownTables(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      if (!line.includes("|")) return line;
      // 행 끝의 이중 파이프 수정: `...-||` → `...---|`
      return line.replace(/\|{2,}\s*$/g, "|");
    })
    .join("\n");
}

interface GistResult {
  url: string;
  id: string;
}

/**
 * GitHub Gist에 마크다운 파일을 생성하고 URL을 반환한다.
 * GITHUB_TOKEN 환경변수가 필요하다.
 * 실패 시 null을 반환한다 (호출부에서 fallback 처리).
 */
export async function createGist(
  filename: string,
  content: string,
  description: string,
): Promise<GistResult | null> {
  const token = process.env.GH_GIST_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token == null || token === "") {
    logger.warn("Gist", "GH_GIST_TOKEN not set, skipping gist creation");
    return null;
  }

  try {
    const response = await fetch(GITHUB_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "market-analyst/1.0",
      },
      body: JSON.stringify({
        description,
        public: false,
        files: { [filename]: { content: sanitizeMarkdownTables(content) } },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.ok === false) {
      const body = await response.text().catch(() => "");
      logger.error("Gist", `Creation failed (${response.status}): ${body}`);
      return null;
    }

    const data = await response.json();
    const url = data?.html_url;
    const id = data?.id;

    if (typeof url !== "string" || typeof id !== "string") {
      logger.error("Gist", "Unexpected response format");
      return null;
    }

    logger.info("Gist", `Created: ${url}`);
    return { url, id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("Gist", `Error: ${reason}`);
    return null;
  }
}
