import { logger } from "@/agent/logger";
import type { AgentTool } from "./types";

const FETCH_TIMEOUT_MS = 10_000;

interface IndexQuote {
  symbol: string;
  name: string;
  close: number;
  change: number;
  changePercent: number;
}

interface FearGreedData {
  score: number;
  rating: string;
  previousClose: number | null;
  previous1Week: number | null;
  previous1Month: number | null;
}

const INDEX_SYMBOLS: Readonly<Record<string, string>> = {
  "^GSPC": "S&P 500",
  "^IXIC": "NASDAQ",
  "^DJI": "DOW 30",
  "^RUT": "Russell 2000",
  "^VIX": "VIX",
} as const;

async function fetchIndexQuote(symbol: string): Promise<IndexQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "market-analyst/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.ok === false) {
    logger.warn("IndexReturns", `HTTP ${response.status} for ${symbol}`);
    return null;
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (result == null) return null;

  const closes = result.indicators?.quote?.[0]?.close;
  if (closes == null || closes.length < 2) return null;

  const prevClose = closes[closes.length - 2];
  const lastClose = closes[closes.length - 1];
  if (prevClose == null || lastClose == null || prevClose === 0) return null;

  const change = lastClose - prevClose;
  const changePercent = (change / prevClose) * 100;

  return {
    symbol,
    name: INDEX_SYMBOLS[symbol] ?? symbol,
    close: Number(lastClose.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
  };
}

async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const response = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://edition.cnn.com/markets/fear-and-greed",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (response.ok === false) {
      logger.warn("FearGreed", `HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const fg = data?.fear_and_greed;
    if (fg == null || typeof fg.score !== "number") return null;

    return {
      score: Number(fg.score.toFixed(1)),
      rating: String(fg.rating ?? "unknown"),
      previousClose:
        typeof fg.previous_close === "number"
          ? Number(fg.previous_close.toFixed(1))
          : null,
      previous1Week:
        typeof fg.previous_1_week === "number"
          ? Number(fg.previous_1_week.toFixed(1))
          : null,
      previous1Month:
        typeof fg.previous_1_month === "number"
          ? Number(fg.previous_1_month.toFixed(1))
          : null,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("FearGreed", `Error: ${reason}`);
    return null;
  }
}

/**
 * 주요 지수 수익률 + VIX + CNN 공포탐욕지수를 조회한다.
 * 외부 API이므로 실패 시 빈 결과를 반환한다.
 */
export const getIndexReturns: AgentTool = {
  definition: {
    name: "get_index_returns",
    description:
      "주요 미국 지수(S&P 500, NASDAQ, DOW, Russell 2000, VIX)의 최근 일간 등락률과 CNN 공포탐욕지수를 조회합니다. 시장 전반의 방향성과 심리 파악에 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  async execute(_input: Record<string, unknown>) {
    const symbols = Object.keys(INDEX_SYMBOLS);

    // 지수 fetch + 공포탐욕지수 fetch 병렬 실행
    const [indexSettled, fearGreed] = await Promise.all([
      Promise.allSettled(symbols.map((symbol) => fetchIndexQuote(symbol))),
      fetchFearGreed(),
    ]);

    const indices: IndexQuote[] = [];
    for (let i = 0; i < indexSettled.length; i++) {
      const outcome = indexSettled[i];
      if (outcome.status === "rejected") {
        const reason =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        logger.warn("IndexReturns", `Error fetching ${symbols[i]}: ${reason}`);
        continue;
      }
      if (outcome.value != null) {
        indices.push(outcome.value);
      }
    }

    if (indices.length === 0 && fearGreed == null) {
      return JSON.stringify({
        error: "시장 데이터를 가져올 수 없습니다",
        indices: [],
        fearGreed: null,
      });
    }

    return JSON.stringify({ indices, fearGreed });
  },
};
