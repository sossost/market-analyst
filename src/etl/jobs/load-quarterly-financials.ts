import "dotenv/config";
import pLimit from "p-limit";
import { db } from "@/db/client";
import { quarterlyFinancials } from "@/db/schema/market";
import { sql } from "drizzle-orm";
import { fetchJson, sleep, toStrNum } from "@/etl/utils/common";
import { asQuarter } from "@/etl/utils/date";
import { ensureSymbol } from "@/etl/utils/db";
import { deduplicateByQuarter } from "@/etl/utils/quarter-deduplication";
import { logger } from "@/agent/logger";

const TAG = "LOAD_QUARTERLY_FINANCIALS";

const API = process.env.DATA_API! + "/stable";
const KEY = process.env.FMP_API_KEY!;
const CONCURRENCY = 4;
const PAUSE_MS = 150;
const LIMIT_Q = 12;

function calculateEPS(
  netIncome: number | null | undefined,
  shares: number | null | undefined,
): number | null {
  if (netIncome == null || shares == null || shares === 0) {
    return null;
  }
  const eps = netIncome / shares;
  return Number.isFinite(eps) ? eps : null;
}

async function upsertQuarter(sym: string, row: Record<string, unknown>) {
  const date = row.date as string;
  const asQ = asQuarter(date);

  const netIncomeNum = row.netIncome != null ? Number(row.netIncome) : null;
  const sharesOut = row.weightedAverageShsOut != null ? Number(row.weightedAverageShsOut) : null;
  const sharesOutDil = row.weightedAverageShsOutDil != null ? Number(row.weightedAverageShsOutDil) : null;

  let epsDilutedValue: number | null = null;
  const apiEpsDiluted =
    row.epsDilutedNonGAAP ?? row.adjustedEPS ?? row.epsDiluted ?? row.eps;
  if (apiEpsDiluted != null && Number(apiEpsDiluted) !== 0) {
    epsDilutedValue = Number(apiEpsDiluted);
  } else if (netIncomeNum != null && sharesOutDil != null) {
    epsDilutedValue = calculateEPS(netIncomeNum, sharesOutDil);
  }

  let epsBasicValue: number | null = null;
  const apiEpsBasic =
    row.epsNonGAAP ?? row.epsBasicNonGAAP ?? row.epsBasic ?? row.eps;
  if (apiEpsBasic != null && Number(apiEpsBasic) !== 0) {
    epsBasicValue = Number(apiEpsBasic);
  } else if (netIncomeNum != null && sharesOut != null) {
    epsBasicValue = calculateEPS(netIncomeNum, sharesOut);
  }

  await db
    .insert(quarterlyFinancials)
    .values({
      symbol: sym,
      periodEndDate: date,
      asOfQ: asQ,
      revenue: toStrNum(row.revenue),
      netIncome: toStrNum(row.netIncome),
      operatingIncome: toStrNum(row.operatingIncome),
      ebitda: toStrNum(row.ebitda),
      grossProfit: toStrNum(row.grossProfit),
      operatingCashFlow: toStrNum(row.operatingCashFlow),
      freeCashFlow: toStrNum(row.freeCashFlow),
      epsDiluted: epsDilutedValue != null ? String(epsDilutedValue) : null,
      epsBasic: epsBasicValue != null ? String(epsBasicValue) : null,
    })
    .onConflictDoUpdate({
      target: [quarterlyFinancials.symbol, quarterlyFinancials.periodEndDate],
      set: {
        asOfQ: asQ,
        revenue: toStrNum(row.revenue),
        netIncome: toStrNum(row.netIncome),
        operatingIncome: toStrNum(row.operatingIncome),
        ebitda: toStrNum(row.ebitda),
        grossProfit: toStrNum(row.grossProfit),
        operatingCashFlow: toStrNum(row.operatingCashFlow),
        freeCashFlow: toStrNum(row.freeCashFlow),
        epsDiluted: epsDilutedValue != null ? String(epsDilutedValue) : null,
        epsBasic: epsBasicValue != null ? String(epsBasicValue) : null,
      },
    });
}

async function loadOne(symbol: string) {
  const isRows: Record<string, unknown>[] = await fetchJson<Record<string, unknown>[]>(
    `${API}/income-statement?symbol=${symbol}&period=quarter&limit=${LIMIT_Q}&apikey=${KEY}`,
  ).catch(() => []);
  isRows.sort((a, b) => ((a.date as string) < (b.date as string) ? 1 : -1));

  await sleep(PAUSE_MS);
  const cfRows: Record<string, unknown>[] = await fetchJson<Record<string, unknown>[]>(
    `${API}/cash-flow-statement?symbol=${symbol}&period=quarter&limit=${LIMIT_Q}&apikey=${KEY}`,
  ).catch(() => []);
  cfRows.sort((a, b) => ((a.date as string) < (b.date as string) ? 1 : -1));

  if (isRows.length === 0) throw new Error(`no income rows: ${symbol}`);

  const map = new Map<string, Record<string, unknown>>();
  for (const r of isRows) map.set(r.date as string, { ...r });
  for (const r of cfRows) {
    const cur = map.get(r.date as string) ?? { date: r.date as string };
    map.set(r.date as string, { ...cur, ...r });
  }

  const quarterMap = deduplicateByQuarter(
    map as Map<string, Record<string, unknown> & { date: string }>,
  );

  await ensureSymbol(symbol);

  for (const [, row] of quarterMap) {
    await upsertQuarter(symbol, row);
  }
}

async function main() {
  logger.info(TAG, "Starting Quarterly Financials ETL...");

  const rs = await db.execute(sql`SELECT symbol FROM symbols`);
  const syms: string[] = (rs.rows as Record<string, unknown>[]).map(
    (r) => r.symbol as string,
  );

  logger.info(TAG, `Processing ${syms.length} symbols`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let skip = 0;

  await Promise.all(
    syms.map((sym) =>
      limit(async () => {
        try {
          await loadOne(sym);
          done++;
          if (done % 50 === 0) logger.info(TAG, `Progress: ${done}/${syms.length} (${sym})`);
        } catch (e: unknown) {
          skip++;
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(TAG, `Skipped ${sym}: ${message}`);
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  logger.info(TAG, `Quarterly Financials ETL completed! ${done} ok, ${skip} skipped`);
}

main().catch((e) => {
  logger.error(TAG, `Quarterly Financials ETL failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

export { main as loadQuarterlyFinancials };
