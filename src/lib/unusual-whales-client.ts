/**
 * Unusual Whales API client.
 *
 * Handles authentication, rate limiting, and response normalization
 * for options flow and dark pool data endpoints.
 */
import { logger } from "@/lib/logger";
import { retryApiCall } from "@/lib/retry";
import type {
  UWApiConfig,
  UWOptionsFlowRaw,
  UWDarkPoolRaw,
  OptionsFlowRecord,
  DarkPoolTradeRecord,
} from "@/types/unusual-whales";

const TAG = "UW_CLIENT";

const DEFAULT_BASE_URL = "https://api.unusualwhales.com/api";

export function createUWApiConfig(): UWApiConfig {
  const apiToken = process.env.UW_API_TOKEN;
  if (apiToken == null || apiToken === "") {
    throw new Error("Missing required environment variable: UW_API_TOKEN");
  }
  const baseUrl = process.env.UW_API_BASE_URL ?? DEFAULT_BASE_URL;
  return { baseUrl, apiToken };
}

async function uwFetch<T>(config: UWApiConfig, path: string): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiToken}`,
    },
  });

  if (!res.ok) {
    const safeUrl = url.replace(/Bearer\s+\S+/g, "Bearer ***");
    throw new Error(`UW API HTTP ${res.status} for ${safeUrl}`);
  }

  return res.json() as Promise<T>;
}

// ─── Options Flow ───────────────────────────────────────────────────────────

interface OptionsFlowResponse {
  data: UWOptionsFlowRaw[];
}

/**
 * Fetch options flow data for a given date.
 * Returns normalized records ready for DB insertion.
 */
export async function fetchOptionsFlow(
  config: UWApiConfig,
  date: string,
): Promise<OptionsFlowRecord[]> {
  logger.info(TAG, `Fetching options flow for ${date}`);

  const response = await retryApiCall(
    () => uwFetch<OptionsFlowResponse>(config, `/stock/flow?date=${date}`),
  );

  const raw = response.data ?? [];
  logger.info(TAG, `Received ${raw.length} options flow records for ${date}`);

  return raw
    .filter((r) => !r.is_etf && r.ticker != null && r.ticker !== "")
    .map((r) => normalizeOptionsFlow(r));
}

function normalizeOptionsFlow(raw: UWOptionsFlowRaw): OptionsFlowRecord {
  return {
    symbol: raw.ticker.toUpperCase(),
    date: raw.date,
    strikePrice: raw.strike_price,
    expireDate: raw.expire_date,
    putCall: raw.put_call,
    sentiment: raw.sentiment,
    premium: raw.premium,
    volume: raw.volume,
    openInterest: raw.open_interest,
    underlyingPrice: raw.underlying_price,
    isSweep: raw.is_sweep,
    isBlock: raw.is_block,
    isUnusual: raw.is_unusual,
    externalId: raw.id,
  };
}

// ─── Dark Pool ──────────────────────────────────────────────────────────────

interface DarkPoolResponse {
  data: UWDarkPoolRaw[];
}

/**
 * Fetch dark pool trades for a given date.
 * Returns normalized records ready for DB insertion.
 */
export async function fetchDarkPoolTrades(
  config: UWApiConfig,
  date: string,
): Promise<DarkPoolTradeRecord[]> {
  logger.info(TAG, `Fetching dark pool trades for ${date}`);

  const response = await retryApiCall(
    () => uwFetch<DarkPoolResponse>(config, `/darkpool?date=${date}`),
  );

  const raw = response.data ?? [];
  logger.info(TAG, `Received ${raw.length} dark pool trades for ${date}`);

  return raw
    .filter((r) => r.ticker != null && r.ticker !== "")
    .map((r) => normalizeDarkPoolTrade(r));
}

function normalizeDarkPoolTrade(raw: UWDarkPoolRaw): DarkPoolTradeRecord {
  return {
    symbol: raw.ticker.toUpperCase(),
    date: raw.date,
    price: raw.price,
    size: raw.size,
    notionalValue: raw.notional_value,
  };
}
