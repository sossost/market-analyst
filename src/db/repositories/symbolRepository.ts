import { pool } from "@/db/client";
import type { SymbolMetaRow } from "./types.js";

/**
 * symbols 테이블 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * 단일 종목의 sector, industry, market_cap을 조회한다.
 * industry는 override 테이블 우선 적용.
 */
export async function findSymbolMeta(
  symbol: string,
): Promise<SymbolMetaRow | null> {
  const { rows } = await pool.query<SymbolMetaRow>(
    `SELECT s.sector, COALESCE(sio.industry, s.industry) AS industry, s.market_cap::text
     FROM symbols s
     LEFT JOIN symbol_industry_overrides sio ON s.symbol = sio.symbol
     WHERE s.symbol = $1`,
    [symbol],
  );

  return rows[0] ?? null;
}
