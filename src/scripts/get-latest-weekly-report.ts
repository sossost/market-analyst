/**
 * get-latest-weekly-report.ts
 *
 * daily_reports DB에서 최신 주간 리포트 2건(이번 주 + 직전)을 조회하여
 * stdout으로 JSON 출력하는 경량 스크립트.
 *
 * Usage: npx tsx src/scripts/get-latest-weekly-report.ts
 */
import "dotenv/config";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { dailyReports } from "../db/schema/analyst.js";
import {
  type ReportEntry,
  type LatestReportResult,
  toEntry,
} from "./get-latest-report.js";

export type { ReportEntry, LatestReportResult };
export { toEntry };

// ---------- Main ----------

async function main(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(dailyReports)
      .where(eq(dailyReports.type, "weekly"))
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
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[get-latest-weekly-report] ${message}`);
  process.exit(1);
});
