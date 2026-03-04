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

const INDEX_SYMBOLS: Readonly<Record<string, string>> = {
  "^GSPC": "S&P 500",
  "^IXIC": "NASDAQ",
  "^DJI": "DOW 30",
  "^RUT": "Russell 2000",
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

/**
 * Yahoo Finance API로 주요 지수의 일간 수익률을 조회한다.
 * 외부 API이므로 실패 시 빈 결과를 반환한다.
 */
export const getIndexReturns: AgentTool = {
  definition: {
    name: "get_index_returns",
    description:
      "주요 미국 지수(S&P 500, NASDAQ, DOW, Russell 2000)의 최근 일간 등락률을 조회합니다. 시장 전반의 방향성 파악에 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  async execute(_input: Record<string, unknown>) {
    const symbols = Object.keys(INDEX_SYMBOLS);

    const settled = await Promise.allSettled(
      symbols.map((symbol) => fetchIndexQuote(symbol)),
    );

    const results: IndexQuote[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "rejected") {
        const reason =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        logger.warn("IndexReturns", `Error fetching ${symbols[i]}: ${reason}`);
        continue;
      }
      if (outcome.value != null) {
        results.push(outcome.value);
      }
    }

    if (results.length === 0) {
      return JSON.stringify({
        error: "지수 데이터를 가져올 수 없습니다",
        indices: [],
      });
    }

    return JSON.stringify({ indices: results });
  },
};
