import { logger } from "@/lib/logger";
import type { AgentTool } from "./types";
import { validateString, validateSymbol } from "./validation";

const BRAVE_NEWS_URL = "https://api.search.brave.com/res/v1/news/search";
const MAX_RESULTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  meta_url?: { hostname: string };
  age?: string;
}

interface BraveNewsResponse {
  results?: BraveNewsResult[];
}

/**
 * Brave Search News API로 종목 관련 뉴스를 검색하여 카탈리스트를 파악한다.
 */
export const searchCatalyst: AgentTool = {
  definition: {
    name: "search_catalyst",
    description:
      "Brave Search API로 종목의 최근 뉴스를 검색합니다. 급등/급락의 카탈리스트(원인)를 파악하는 데 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: {
          type: "string",
          description: "종목 티커 (예: NVDA, AAPL)",
        },
        companyName: {
          type: "string",
          description: "회사명 (예: NVIDIA Corporation)",
        },
      },
      required: ["ticker", "companyName"],
    },
  },

  async execute(input) {
    const ticker = validateSymbol(input.ticker);
    if (ticker == null) {
      return JSON.stringify({ error: "Invalid or missing ticker" });
    }

    const companyName = validateString(input.companyName);
    if (companyName == null) {
      return JSON.stringify({ error: "Invalid or missing companyName" });
    }

    const apiKey = process.env.BRAVE_API_KEY;
    if (apiKey == null || apiKey === "") {
      logger.warn("BraveSearch", "BRAVE_API_KEY not set, skipping search");
      return JSON.stringify({ ticker, results: [], error: "API key not set" });
    }

    const query = `${ticker} ${companyName} stock news`;
    const params = new URLSearchParams({
      q: query,
      count: String(MAX_RESULTS),
      freshness: "pw",
    });

    try {
      const response = await fetch(`${BRAVE_NEWS_URL}?${params}`, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok === false) {
        const body = await response.text().catch(() => "");
        logger.error(
          "BraveSearch",
          `API failed (${response.status}): ${body}`,
        );
        return JSON.stringify({ ticker, results: [] });
      }

      const data = (await response.json()) as BraveNewsResponse;
      const results = (data.results ?? []).slice(0, MAX_RESULTS).map((r) => ({
        title: r.title,
        source: r.meta_url?.hostname ?? "unknown",
        url: r.url,
        age: r.age ?? "unknown",
      }));

      return JSON.stringify({ ticker, results });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("BraveSearch", `Search failed: ${reason}`);
      return JSON.stringify({ ticker, results: [] });
    }
  },
};
