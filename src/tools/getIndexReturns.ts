import { db } from "@/db/client";
import { indexPrices } from "@/db/schema/market";
import { desc, eq, and } from "drizzle-orm";
import { fetchJson, toStrNum } from "@/etl/utils/common";
import { logger } from "@/lib/logger";
import type { AgentTool } from "./types";

const FETCH_TIMEOUT_MS = 10_000;
const DB_QUERY_LIMIT_DAILY = 2;
const DB_QUERY_LIMIT_WEEKLY = 10;

interface IndexQuote {
  symbol: string;
  name: string;
  close: number;
  change: number;
  changePercent: number;
}

type ClosePosition = "near_high" | "near_low" | "mid";

interface WeeklyIndexQuote {
  symbol: string;
  name: string;
  weekStartClose: number;
  weekEndClose: number;
  weeklyChange: number;
  weeklyChangePercent: number;
  weekHigh: number;
  weekLow: number;
  closePosition: ClosePosition;
  tradingDays: number;
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

const FMP_SYMBOL_MAP: Readonly<Record<string, string>> = {
  "^GSPC": "%5EGSPC",
  "^IXIC": "%5EIXIC",
  "^DJI": "%5EDJI",
  "^RUT": "%5ERUT",
  "^VIX": "%5EVIX",
} as const;

interface IndexPriceRow {
  date: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  volume: string | null;
}

async function queryIndexPricesFromDb(
  symbol: string,
  limit: number,
): Promise<IndexPriceRow[]> {
  const rows = await db
    .select({
      date: indexPrices.date,
      open: indexPrices.open,
      high: indexPrices.high,
      low: indexPrices.low,
      close: indexPrices.close,
      volume: indexPrices.volume,
    })
    .from(indexPrices)
    .where(eq(indexPrices.symbol, symbol))
    .orderBy(desc(indexPrices.date))
    .limit(limit);

  return rows;
}

interface FmpHistoricalRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchIndexPricesFromFmp(
  symbol: string,
  days: number,
): Promise<IndexPriceRow[]> {
  const fmpSymbol = FMP_SYMBOL_MAP[symbol];
  if (fmpSymbol == null) return [];

  const api = process.env.DATA_API;
  const key = process.env.FMP_API_KEY;
  if (api == null || key == null) return [];

  const url = `${api}/api/v3/historical-price-full/${fmpSymbol}?timeseries=${days}&apikey=${key}`;
  const data = await fetchJson<{ historical?: FmpHistoricalRow[] }>(url);
  const rows = data?.historical ?? [];

  return rows.map((r) => ({
    date: r.date,
    open: toStrNum(r.open),
    high: toStrNum(r.high),
    low: toStrNum(r.low),
    close: toStrNum(r.close),
    volume: toStrNum(r.volume),
  }));
}

async function getIndexPrices(
  symbol: string,
  limit: number,
): Promise<IndexPriceRow[]> {
  try {
    const dbRows = await queryIndexPricesFromDb(symbol, limit);
    if (dbRows.length >= 2) return dbRows;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("IndexReturns", `DB query failed for ${symbol}, falling back to FMP: ${reason}`);
  }

  try {
    return await fetchIndexPricesFromFmp(symbol, limit + 3);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("IndexReturns", `FMP fallback failed for ${symbol}: ${reason}`);
    return [];
  }
}

function computeDailyQuote(
  symbol: string,
  rows: IndexPriceRow[],
): IndexQuote | null {
  if (rows.length < 2) return null;

  const todayClose = Number(rows[0].close);
  const prevClose = Number(rows[1].close);

  if (!Number.isFinite(todayClose) || !Number.isFinite(prevClose) || prevClose === 0) {
    return null;
  }

  const change = todayClose - prevClose;
  const changePercent = (change / prevClose) * 100;

  return {
    symbol,
    name: INDEX_SYMBOLS[symbol] ?? symbol,
    close: Number(todayClose.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
  };
}

function determineClosePosition(
  close: number,
  high: number,
  low: number,
): ClosePosition {
  const range = high - low;
  if (range === 0) return "mid";

  const positionRatio = (close - low) / range;
  const UPPER_THRESHOLD = 0.7;
  const LOWER_THRESHOLD = 0.3;

  if (positionRatio >= UPPER_THRESHOLD) return "near_high";
  if (positionRatio <= LOWER_THRESHOLD) return "near_low";
  return "mid";
}

function computeWeeklyQuote(
  symbol: string,
  rows: IndexPriceRow[],
): WeeklyIndexQuote | null {
  // rows are sorted desc by date — reverse for chronological order
  const chronological = [...rows].reverse();

  const closes = chronological
    .map((r) => Number(r.close))
    .filter((c) => Number.isFinite(c));
  const highs = chronological
    .map((r) => Number(r.high))
    .filter((h) => Number.isFinite(h));
  const lows = chronological
    .map((r) => Number(r.low))
    .filter((l) => Number.isFinite(l));

  if (closes.length < 2 || highs.length === 0 || lows.length === 0) return null;

  const weekStartClose = closes[0];
  const weekEndClose = closes[closes.length - 1];
  const weekHigh = Math.max(...highs);
  const weekLow = Math.min(...lows);

  if (weekStartClose === 0) return null;

  const weeklyChange = weekEndClose - weekStartClose;
  const weeklyChangePercent = (weeklyChange / weekStartClose) * 100;

  return {
    symbol,
    name: INDEX_SYMBOLS[symbol] ?? symbol,
    weekStartClose: Number(weekStartClose.toFixed(2)),
    weekEndClose: Number(weekEndClose.toFixed(2)),
    weeklyChange: Number(weeklyChange.toFixed(2)),
    weeklyChangePercent: Number(weeklyChangePercent.toFixed(2)),
    weekHigh: Number(weekHigh.toFixed(2)),
    weekLow: Number(weekLow.toFixed(2)),
    closePosition: determineClosePosition(weekEndClose, weekHigh, weekLow),
    tradingDays: closes.length,
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
 * DB 우선 조회 → FMP API fallback → Fear & Greed는 CNN 유지.
 */
export const getIndexReturns: AgentTool = {
  definition: {
    name: "get_index_returns",
    description:
      "주요 미국 지수(S&P 500, NASDAQ, DOW, Russell 2000, VIX)의 등락률과 CNN 공포탐욕지수를 조회합니다. daily(기본): 일간 등락률, weekly: 주간 누적 등락률 + 주간 고저 위치. 시장 전반의 방향성과 심리 파악에 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["daily", "weekly"],
          description:
            "조회 모드. daily(기본): 일간 등락률, weekly: 주간 누적 등락률 + 주간 고저 위치",
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>) {
    const mode = input.mode === "weekly" ? "weekly" : "daily";
    const symbols = Object.keys(INDEX_SYMBOLS);
    const queryLimit =
      mode === "weekly" ? DB_QUERY_LIMIT_WEEKLY : DB_QUERY_LIMIT_DAILY;

    if (mode === "weekly") {
      const [weeklySettled, fearGreed] = await Promise.all([
        Promise.allSettled(
          symbols.map(async (symbol) => {
            const rows = await getIndexPrices(symbol, queryLimit);
            return computeWeeklyQuote(symbol, rows);
          }),
        ),
        fetchFearGreed(),
      ]);

      const weeklyIndices: WeeklyIndexQuote[] = [];
      for (let i = 0; i < weeklySettled.length; i++) {
        const outcome = weeklySettled[i];
        if (outcome.status === "rejected") {
          const reason =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          logger.warn(
            "IndexReturns",
            `Error fetching weekly ${symbols[i]}: ${reason}`,
          );
          continue;
        }
        if (outcome.value != null) {
          weeklyIndices.push(outcome.value);
        }
      }

      if (weeklyIndices.length === 0 && fearGreed == null) {
        return JSON.stringify({
          error: "시장 데이터를 가져올 수 없습니다",
          mode: "weekly",
          indices: [],
          fearGreed: null,
        });
      }

      return JSON.stringify({
        mode: "weekly",
        indices: weeklyIndices,
        fearGreed,
      });
    }

    // daily 모드
    const [indexSettled, fearGreed] = await Promise.all([
      Promise.allSettled(
        symbols.map(async (symbol) => {
          const rows = await getIndexPrices(symbol, queryLimit);
          return computeDailyQuote(symbol, rows);
        }),
      ),
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
