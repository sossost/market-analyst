import { pool } from "@/db/client";
import type { PriceRow } from "./types.js";

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
