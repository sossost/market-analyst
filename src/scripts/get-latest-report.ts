/**
 * get-latest-report.ts
 *
 * daily_reports DB에서 최신 일간 리포트 2건(오늘 + 직전)을 조회하여
 * stdout으로 JSON 출력하는 경량 스크립트.
 *
 * Usage: npx tsx src/scripts/get-latest-report.ts
 */
import "dotenv/config";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { dailyReports } from "../db/schema/analyst.js";

// ---------- Types ----------

export interface ReportedSymbol {
  symbol: string;
  phase: number;
  rsScore: number;
  sector: string;
  reason: string;
}

export interface MarketSummary {
  phase2Ratio: number;
  leadingSectors: string[];
  totalAnalyzed: number;
}

export interface ReportEntry {
  date: string;
  content: string;
}

export interface LatestReportResult {
  today: ReportEntry;
  prev: ReportEntry | null;
}

// ---------- Helpers ----------

export function formatReportedSymbols(symbols: ReportedSymbol[]): string {
  if (symbols.length === 0) {
    return "추천 종목 없음";
  }

  const lines = symbols.map(
    (s) =>
      `- **${s.symbol}** | Phase ${s.phase} | RS ${s.rsScore} | ${s.sector}\n  ${s.reason}`,
  );

  return `## 추천 종목 (${symbols.length}건)\n\n${lines.join("\n")}`;
}

export function formatMarketSummary(summary: MarketSummary): string {
  const sectors =
    summary.leadingSectors.length > 0
      ? summary.leadingSectors.join(", ")
      : "없음";

  return [
    "## 시장 요약",
    "",
    `- Phase 2 비율: ${summary.phase2Ratio.toFixed(1)}%`,
    `- 주도 섹터: ${sectors}`,
    `- 분석 대상: ${summary.totalAnalyzed}개 종목`,
  ].join("\n");
}

export function buildFallbackContent(
  symbols: ReportedSymbol[],
  summary: MarketSummary,
): string {
  return [formatMarketSummary(summary), "", formatReportedSymbols(symbols)].join(
    "\n",
  );
}

// ---------- Row → Entry ----------

type DailyReportRow = {
  reportDate: string;
  fullContent: string | null;
  reportedSymbols: unknown;
  marketSummary: unknown;
};

export function toEntry(row: DailyReportRow): ReportEntry {
  const content =
    row.fullContent ??
    buildFallbackContent(
      (row.reportedSymbols ?? []) as ReportedSymbol[],
      (row.marketSummary ?? {
        phase2Ratio: 0,
        leadingSectors: [],
        totalAnalyzed: 0,
      }) as MarketSummary,
    );

  return { date: row.reportDate, content };
}

// ---------- Main ----------

async function main(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(dailyReports)
      .where(eq(dailyReports.type, "daily"))
      .orderBy(desc(dailyReports.reportDate))
      .limit(2);

    if (rows.length === 0) {
      console.log(JSON.stringify(null));
      return;
    }

    const today = toEntry(rows[0]);
    const prev = rows.length >= 2 ? toEntry(rows[1]) : null;

    const result: LatestReportResult = { today, prev };
    console.log(JSON.stringify(result));
  } finally {
    await pool.end().catch((err) => {
      // pool이 이미 종료됐거나 종료 중인 경우 에러 무시 (원본 에러 전파를 막지 않기 위함)
      console.warn(
        "[WARN] pool.end() failed, ignoring: " +
          (err instanceof Error ? err.message : String(err)),
      );
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[get-latest-report] ${message}`);
  process.exit(1);
});
