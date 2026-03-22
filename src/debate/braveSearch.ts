import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";

const BRAVE_WEB_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_NEWS_URL = "https://api.search.brave.com/res/v1/news/search";
const MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 10_000;

interface BraveResult {
  title: string;
  url: string;
  description: string;
  meta_url?: { hostname: string };
  age?: string;
}

interface BraveResponse {
  results?: BraveResult[];
  web?: { results?: BraveResult[] };
}

/**
 * Tool definitions for debate agents — web search + news search.
 */
export const DEBATE_TOOLS: Anthropic.Tool[] = [
  {
    name: "web_search",
    description:
      "웹 검색으로 최신 정보를 조회합니다. 시장 데이터, 경제 지표, 정책 발표, 기업 실적 등을 확인할 때 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "검색 쿼리 (영어 권장)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "news_search",
    description:
      "최신 뉴스를 검색합니다. 시장 이벤트, 정책 변화, 산업 동향을 파악할 때 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "뉴스 검색 쿼리 (영어 권장)",
        },
      },
      required: ["query"],
    },
  },
];

async function fetchBrave(
  url: string,
  query: string,
): Promise<string> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (apiKey == null || apiKey === "") {
    return JSON.stringify({ error: "BRAVE_API_KEY not set", results: [] });
  }

  const params = new URLSearchParams({
    q: query,
    count: String(MAX_RESULTS),
  });

  try {
    const response = await fetch(`${url}?${params}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.ok === false) {
      return JSON.stringify({ error: `API ${response.status}`, results: [] });
    }

    const data = (await response.json()) as BraveResponse;
    const rawResults = data.results ?? data.web?.results ?? [];
    const results = rawResults.slice(0, MAX_RESULTS).map((r) => ({
      title: r.title,
      source: r.meta_url?.hostname ?? "unknown",
      description: r.description,
      age: r.age,
    }));

    const json = JSON.stringify({ query, results });
    return `<search-results source="brave" trust="external">\n${json}\n</search-results>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("BraveSearch", `Search failed: ${msg}`);
    return JSON.stringify({ error: msg, results: [] });
  }
}

/**
 * Execute a debate tool by name.
 */
export async function executeDebateTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const query = typeof input.query === "string" ? input.query : "";
  if (query === "") {
    return JSON.stringify({ error: "Empty query" });
  }

  switch (name) {
    case "web_search":
      return fetchBrave(BRAVE_WEB_URL, query);
    case "news_search":
      return fetchBrave(BRAVE_NEWS_URL, query);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
