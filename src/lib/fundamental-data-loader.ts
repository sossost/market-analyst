/**
 * DB에서 펀더멘탈 분석용 분기 실적 데이터를 로드.
 *
 * quarterly_financials + quarterly_ratios를 조인하여
 * 종목별 최근 8분기 데이터를 반환한다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { FundamentalInput, QuarterlyData } from "../types/fundamental.js";

const QUARTERS_TO_LOAD = 8;
const MAX_SYMBOLS_PER_QUERY = 500;

/**
 * 여러 종목의 펀더멘탈 데이터를 한 번에 로드.
 * 종목당 최근 8분기 데이터를 반환한다.
 */
export async function loadFundamentalData(
  symbols: string[],
): Promise<FundamentalInput[]> {
  if (symbols.length === 0) return [];
  if (symbols.length > MAX_SYMBOLS_PER_QUERY) {
    throw new Error(`symbols 배열 초과: ${symbols.length} > ${MAX_SYMBOLS_PER_QUERY}`);
  }

  const rows = await db.execute(sql`
    SELECT symbol, period_end_date, as_of_q, revenue, net_income, eps_diluted, net_margin
    FROM (
      SELECT
        f.symbol,
        f.period_end_date,
        f.as_of_q,
        f.revenue,
        f.net_income,
        f.eps_diluted,
        r.net_margin,
        ROW_NUMBER() OVER (PARTITION BY f.symbol ORDER BY f.period_end_date DESC) AS rn
      FROM quarterly_financials f
      LEFT JOIN quarterly_ratios r
        ON f.symbol = r.symbol AND f.period_end_date = r.period_end_date
      WHERE f.symbol = ANY(${symbols})
    ) sub
    WHERE rn <= ${QUARTERS_TO_LOAD}
    ORDER BY symbol, period_end_date DESC
  `);

  return groupBySymbol(rows.rows as unknown as RawRow[], symbols);
}

interface RawRow {
  symbol: string;
  period_end_date: string;
  as_of_q: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  net_margin: string | null;
}

function groupBySymbol(rows: RawRow[], symbols: string[]): FundamentalInput[] {
  const map = new Map<string, QuarterlyData[]>();

  for (const row of rows) {
    if (!map.has(row.symbol)) {
      map.set(row.symbol, []);
    }

    const quarters = map.get(row.symbol)!;
    if (quarters.length >= QUARTERS_TO_LOAD) continue;

    quarters.push({
      periodEndDate: row.period_end_date,
      asOfQ: row.as_of_q,
      revenue: toNumber(row.revenue),
      netIncome: toNumber(row.net_income),
      epsDiluted: toNumber(row.eps_diluted),
      netMargin: toNumber(row.net_margin),
    });
  }

  return symbols.map((symbol) => ({
    symbol,
    quarters: map.get(symbol) ?? [],
  }));
}

function toNumber(val: string | null): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}
