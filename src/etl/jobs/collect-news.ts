import "dotenv/config";
import { db, pool } from "@/db/client";
import { newsArchive } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { classifyCategory, classifySentiment } from "@/lib/newsClassifier";
import { logger } from "@/lib/logger";

const TAG = "COLLECT_NEWS";

const BRAVE_NEWS_URL = "https://api.search.brave.com/res/v1/news/search";
const MAX_RESULTS_PER_QUERY = 5;
const FETCH_TIMEOUT_MS = 10_000;
const RATE_LIMIT_DELAY_MS = 1_000;

/**
 * 애널리스트 페르소나별 검색 쿼리.
 * newsCollector.ts와 동일한 쿼리 세트.
 */
const SEARCH_QUERIES: Record<string, string[]> = {
  macro: [
    "Federal Reserve interest rate policy today",
    "US economy GDP employment inflation latest",
    "fiscal policy federal budget executive order economic structural impact",
    "credit spread high yield CLO leveraged loan stress",
    "private credit private equity default risk latest",
  ],
  tech: [
    "AI semiconductor technology stocks earnings latest",
    "cloud computing capex hyperscaler spending 2026",
  ],
  geopolitics: [
    "US China trade tariff sanctions latest",
    "geopolitical risk oil supply chain disruption",
    "US legislation bill regulation tariff subsidy sector impact latest",
  ],
  sentiment: [
    "stock market sentiment VIX fear greed index",
    "ETF fund flows institutional positioning",
    "credit market risk appetite junk bond spread",
  ],
};

interface BraveNewsResult {
  title: string;
  url: string;
  description?: string;
  meta_url?: { hostname?: string };
  age?: string;
}

interface BraveNewsResponse {
  results?: BraveNewsResult[];
}

/**
 * Brave News Search API를 호출하여 뉴스 결과를 반환한다.
 * URL이 없는 결과는 필터링한다.
 */
async function searchBraveNews(
  query: string,
  apiKey: string,
): Promise<BraveNewsResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(MAX_RESULTS_PER_QUERY),
  });

  try {
    const response = await fetch(`${BRAVE_NEWS_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(TAG, `Brave API ${response.status} for query: ${query}`);
      return [];
    }

    const data = (await response.json()) as BraveNewsResponse;
    const results = data.results ?? [];

    return results
      .slice(0, MAX_RESULTS_PER_QUERY)
      .filter((r) => r.url != null && r.url !== "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(TAG, `Brave search failed: ${msg}`);
    return [];
  }
}

/**
 * Brave의 age 문자열("2 hours ago" 등)을 ISO datetime으로 변환 시도.
 * 파싱 실패 시 null 반환.
 */
export function parseAge(age: string | undefined): string | null {
  if (age == null || age === "") return null;

  const now = Date.now();
  const match = age.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (match == null) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const MS_PER_UNIT: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };

  const ms = MS_PER_UNIT[unit];
  if (ms == null) return null;

  const date = new Date(now - amount * ms);
  return date.toISOString();
}

/**
 * URL에서 hostname을 안전하게 추출한다.
 * 파싱 실패 시 null 반환.
 */
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * 단일 쿼리에 대한 뉴스 수집 + DB 저장을 처리한다.
 * Rate limit 준수를 위해 순차 호출된다.
 */
async function processQuery(
  persona: string,
  query: string,
  apiKey: string,
): Promise<{ fetched: number; inserted: number }> {
  const results = await searchBraveNews(query, apiKey);
  let inserted = 0;

  for (const result of results) {
    const text = `${result.title} ${result.description ?? ""}`;
    const category = classifyCategory(text);
    const sentiment = classifySentiment(text);
    const source = result.meta_url?.hostname ?? safeHostname(result.url) ?? "unknown";
    const publishedAt = parseAge(result.age);

    try {
      const insertResult = await db
        .insert(newsArchive)
        .values({
          url: result.url,
          title: result.title,
          description: result.description ?? null,
          source,
          publishedAt,
          category,
          sentiment,
          queryPersona: persona,
          queryText: query,
        })
        .onConflictDoNothing({ target: newsArchive.url });

      if (insertResult.rowCount != null && insertResult.rowCount > 0) {
        inserted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(TAG, `Insert failed for ${result.url}: ${msg}`);
    }
  }

  return { fetched: results.length, inserted };
}

/**
 * 뉴스 수집 메인 함수.
 * 1. 각 페르소나별 쿼리로 Brave News Search 호출
 * 2. URL 기반 중복 제거 (DB UNIQUE constraint 활용)
 * 3. 키워드 기반 카테고리/감성 분류
 * 4. DB upsert (ON CONFLICT DO NOTHING)
 */
export async function collectAndStoreNews(): Promise<{
  totalFetched: number;
  inserted: number;
}> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (apiKey == null || apiKey === "") {
    throw new Error("BRAVE_API_KEY is not set. Cannot collect news.");
  }

  let totalFetched = 0;
  let totalInserted = 0;

  const isTest = process.env.NODE_ENV === "test";
  const delayMs = isTest ? 0 : RATE_LIMIT_DELAY_MS;

  for (const [persona, queries] of Object.entries(SEARCH_QUERIES)) {
    for (const query of queries) {
      const { fetched, inserted } = await processQuery(persona, query, apiKey);
      totalFetched += fetched;
      totalInserted += inserted;

      if (delayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }
  }

  return { totalFetched, inserted: totalInserted };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  logger.info(TAG, "Collect news archive — starting");

  const { totalFetched, inserted } = await collectAndStoreNews();

  logger.info(TAG, `Collect news archive — done: ${totalFetched} fetched, ${inserted} new inserted`);

  await pool.end();
}

main().catch(async (err) => {
  logger.error(TAG, `collect-news failed: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});
