/**
 * get-latest-debate-report.ts
 *
 * debate_sessions DB에서 최신 토론 리포트 2건(오늘 + 직전)을 조회하여
 * stdout으로 JSON 출력하는 경량 스크립트.
 *
 * Usage: npx tsx src/scripts/get-latest-debate-report.ts
 */
import "dotenv/config";
import { desc } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { debateSessions } from "../db/schema/analyst.js";

// ---------- Types ----------

export interface DebateReportEntry {
  date: string;
  content: string;
  thesesCount: number;
}

export interface LatestDebateReportResult {
  today: DebateReportEntry;
  prev: DebateReportEntry | null;
}

// ---------- Row → Entry ----------

type DebateSessionRow = {
  date: string;
  synthesisReport: string;
  thesesCount: number;
};

export function toDebateEntry(row: DebateSessionRow): DebateReportEntry {
  return {
    date: row.date,
    content: row.synthesisReport,
    thesesCount: row.thesesCount,
  };
}

// ---------- Main ----------

async function main(): Promise<void> {
  try {
    const rows = await db
      .select({
        date: debateSessions.date,
        synthesisReport: debateSessions.synthesisReport,
        thesesCount: debateSessions.thesesCount,
      })
      .from(debateSessions)
      .orderBy(desc(debateSessions.date))
      .limit(2);

    if (rows.length === 0) {
      console.log(JSON.stringify(null));
      return;
    }

    const today = toDebateEntry(rows[0]);
    const prev = rows.length >= 2 ? toDebateEntry(rows[1]) : null;

    const result: LatestDebateReportResult = { today, prev };
    console.log(JSON.stringify(result));
  } finally {
    await pool.end().catch(() => {
      // pool이 이미 종료됐거나 종료 중인 경우 에러 무시
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[get-latest-debate-report] ${message}`);
  process.exit(1);
});
