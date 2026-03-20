/**
 * Unusual Whales API types.
 * Options flow, dark pool, and smart flow signal types.
 */

// ─── API Response Types ─────────────────────────────────────────────────────

/** Raw options flow contract from Unusual Whales API. */
export interface UWOptionsFlowRaw {
  id: string;
  ticker: string;
  date: string;
  strike_price: string;
  expire_date: string;
  put_call: "CALL" | "PUT";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  premium: string;
  volume: number;
  open_interest: number;
  underlying_price: string;
  is_sweep: boolean;
  is_block: boolean;
  is_etf: boolean;
  is_unusual: boolean;
}

/** Raw dark pool transaction from Unusual Whales API. */
export interface UWDarkPoolRaw {
  ticker: string;
  date: string;
  price: string;
  size: number;
  notional_value: string;
  tracking_timestamp: string;
}

// ─── Normalized DB-ready Types ──────────────────────────────────────────────

export interface OptionsFlowRecord {
  symbol: string;
  date: string;
  strikePrice: string;
  expireDate: string;
  putCall: "CALL" | "PUT";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  premium: string;
  volume: number;
  openInterest: number;
  underlyingPrice: string;
  isSweep: boolean;
  isBlock: boolean;
  isUnusual: boolean;
  externalId: string;
}

export interface DarkPoolTradeRecord {
  symbol: string;
  date: string;
  price: string;
  size: number;
  notionalValue: string;
}

// ─── Aggregated Signal Types ────────────────────────────────────────────────

/** Daily aggregated options flow metrics per symbol. */
export interface OptionsFlowDailyAgg {
  symbol: string;
  date: string;
  totalPremium: number;
  callPremium: number;
  putPremium: number;
  callPutRatio: number; // callPremium / putPremium (Infinity → capped at 99)
  totalContracts: number;
  sweepCount: number;
  blockCount: number;
  unusualCount: number;
  bullishPremium: number;
  bearishPremium: number;
  sentimentScore: number; // -100 to +100 (bullish bias positive)
}

/** Daily aggregated dark pool metrics per symbol. */
export interface DarkPoolDailyAgg {
  symbol: string;
  date: string;
  totalNotional: number;
  totalShares: number;
  tradeCount: number;
  avgPrice: number;
  blockSize: number; // average trade size
}

// ─── Smart Flow Signal ──────────────────────────────────────────────────────

export type SmartFlowSignalType =
  | "BULLISH_SWEEP" // aggressive call sweeps
  | "DARK_ACCUMULATION" // large dark pool buying
  | "OPTIONS_SURGE" // unusual options activity spike
  | "MIXED"; // multiple signal types combined

export type SmartFlowStrength = "STRONG" | "MODERATE" | "WEAK";

/** Composite signal combining options flow + dark pool for a stock. */
export interface SmartFlowSignal {
  symbol: string;
  date: string;
  signalType: SmartFlowSignalType;
  strength: SmartFlowStrength;
  /** -100 to +100. Positive = bullish institutional flow. */
  compositeScore: number;
  /** Whether this signal confirms an existing Phase 2 / RS signal. */
  confirmsExisting: boolean;
  details: {
    optionsFlow: OptionsFlowDailyAgg | null;
    darkPool: DarkPoolDailyAgg | null;
  };
}

// ─── API Client Config ──────────────────────────────────────────────────────

export interface UWApiConfig {
  baseUrl: string;
  apiToken: string;
}
