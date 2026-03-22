import { pool } from "@/db/client";
import type { SymbolMetaRow } from "./types.js";

/**
 * symbols 테이블 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * 단일 종목의 sector, industry, market_cap을 조회한다.
 */
export async function findSymbolMeta(
  symbol: string,
): Promise<SymbolMetaRow | null> {
  const { rows } = await pool.query<SymbolMetaRow>(
    `SELECT sector, industry, market_cap::text
     FROM symbols WHERE symbol = $1`,
    [symbol],
  );

  return rows[0] ?? null;
}
