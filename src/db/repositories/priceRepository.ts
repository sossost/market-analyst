import { pool } from "@/db/client";
import type { PriceRow, PriceWithMaRow, LatestCloseRow } from "./types.js";

/**
 * daily_prices, daily_ma 관련 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * 지정된 symbols의 당일 종가, 전일 종가, 거래량, 20일 평균 거래량을 조회한다.
 * daily_prices와 daily_ma를 JOIN한다 (priceDeclineFilter.ts 용).
 */
export async function fetchPriceData(
  symbols: string[],
  date: string,
): Promise<PriceRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<PriceRow>(
    `SELECT
       dp.symbol,
       dp.close,
       prev_dp.close AS prev_close,
       dp.volume,
       dm.vol_ma30
     FROM daily_prices dp
     LEFT JOIN daily_prices prev_dp
       ON prev_dp.symbol = dp.symbol
       AND prev_dp.date = (
         SELECT MAX(date)
         FROM daily_prices
         WHERE symbol = dp.symbol
           AND date < $1
       )
     LEFT JOIN daily_ma dm
       ON dm.symbol = dp.symbol
       AND dm.date = $1
     WHERE dp.date = $1
       AND dp.symbol = ANY($2::text[])`,
    [date, symbols],
  );

  return rows;
}

/**
 * 단일 종목의 종가, 거래량, MA50, MA200을 조회한다 (getStockDetail 전용).
 * daily_prices와 daily_ma를 LEFT JOIN한다.
 */
export async function findPriceWithMa(
  symbol: string,
  date: string,
): Promise<PriceWithMaRow | null> {
  const { rows } = await pool.query<PriceWithMaRow>(
    `SELECT dp.close::text, dp.volume::text,
            dm.ma50::text, dm.ma200::text
     FROM daily_prices dp
     LEFT JOIN daily_ma dm ON dp.symbol = dm.symbol AND dp.date = dm.date
     WHERE dp.symbol = $1 AND dp.date = $2`,
    [symbol, date],
  );

  return rows[0] ?? null;
}

/**
 * 지정 symbols의 당일 종가를 일괄 조회한다 (saveRecommendations 진입가 교정용).
 */
export async function findLatestClose(
  symbols: string[],
  date: string,
): Promise<LatestCloseRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<LatestCloseRow>(
    `SELECT symbol, close FROM daily_prices WHERE symbol = ANY($1) AND date = $2`,
    [symbols, date],
  );

  return rows;
}
