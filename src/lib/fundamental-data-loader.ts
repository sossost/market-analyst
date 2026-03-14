/**
 * DB에서 펀더멘탈 분석용 분기 실적 데이터를 로드.
 *
 * quarterly_financials + quarterly_ratios를 조인하여
 * 종목별 최근 8분기 데이터를 반환한다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { FundamentalInput, QuarterlyData } from "../types/fundamental.js";
import { parseQuarterStr } from "./quarter-utils.js";

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
      WHERE f.symbol IN (${sql.join(symbols.map((s) => sql`${s}`), sql`, `)})
    ) sub
    WHERE rn <= ${QUARTERS_TO_LOAD}
    ORDER BY symbol, period_end_date DESC
  `);

  return groupBySymbol(rows.rows as unknown as RawRow[], symbols);
}

/** @internal — 테스트용 export */
export interface RawRow {
  symbol: string;
  period_end_date: string;
  as_of_q: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  net_margin: string | null;
}

/** @internal — 테스트용 export */
export function groupBySymbol(rows: RawRow[], symbols: string[]): FundamentalInput[] {
  const map = new Map<string, QuarterlyData[]>();

  for (const row of rows) {
    if (!map.has(row.symbol)) {
      map.set(row.symbol, []);
    }

    const quarters = map.get(row.symbol)!;
    if (quarters.length >= QUARTERS_TO_LOAD) continue;

    // 같은 분기가 이미 존재하면 스킵 — 포맷 정규화 후 비교하여 "Q4 2024" vs "2024Q4" 중복 감지
    if (quarters.some((q) => isSameQuarter(q.asOfQ, row.as_of_q))) continue;

    quarters.push({
      periodEndDate: row.period_end_date,
      asOfQ: row.as_of_q,
      revenue: toNumber(row.revenue),
      netIncome: toNumber(row.net_income),
      epsDiluted: toNumber(row.eps_diluted),
      netMargin: normalizeMargin(toNumber(row.net_margin)),
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

/**
 * as_of_q 문자열을 (year, quarter) 쌍으로 파싱하여 동일 분기 여부 판단.
 * 지원 포맷: "Q4 2025", "2025Q4"
 * 파싱 실패 시 문자열 동일성 fallback.
 */
function isSameQuarter(a: string, b: string): boolean {
  const parsedA = parseQuarterStr(a);
  const parsedB = parseQuarterStr(b);

  if (parsedA == null || parsedB == null) {
    return a === b;
  }

  return parsedA.year === parsedB.year && parsedA.quarter === parsedB.quarter;
}

/**
 * DB의 net_margin은 대부분 소수 단위(0~1)로 저장된다.
 * scorer는 퍼센트 단위(0~100%)를 기대하므로, 소수 단위 값을 ×100으로 변환한다.
 *
 * 판단 기준: 절댓값이 MARGIN_DECIMAL_THRESHOLD 이하이면 소수 단위 → ×100.
 * 이미 퍼센트 단위인 값(예: 57.0, -5.2)은 그대로 반환.
 */
const MARGIN_DECIMAL_THRESHOLD = 1; // 절댓값이 1 이하이면 소수 단위로 판단

function normalizeMargin(val: number | null): number | null {
  if (val == null) return null;
  if (Math.abs(val) <= MARGIN_DECIMAL_THRESHOLD) return val * 100;
  return val;
}
