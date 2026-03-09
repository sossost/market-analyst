import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { DailyReportLog } from "@/types";
import { db } from "../db/client.js";
import { dailyReports } from "../db/schema/analyst.js";
import { logger } from "./logger";

const REPORTS_DIR = path.resolve(process.cwd(), "data/reports");

/**
 * Ensure the reports directory exists.
 */
function ensureDir(): void {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Get the file path for a given date's report.
 */
function reportPath(date: string): string {
  return path.join(REPORTS_DIR, `${date}.json`);
}

/**
 * Read report logs for the last N days from file system.
 * Returns an array of logs, most recent first.
 * Missing dates are silently skipped.
 */
export function readReportLogs(daysBack: number): DailyReportLog[] {
  ensureDir();

  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
  files.sort().reverse();

  const logs: DailyReportLog[] = [];
  const toRead = Math.min(files.length, daysBack);

  for (let i = 0; i < toRead; i++) {
    try {
      const content = fs.readFileSync(
        path.join(REPORTS_DIR, files[i]),
        "utf-8",
      );
      logs.push(JSON.parse(content) as DailyReportLog);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      logger.warn("ReportLog", `Skipping corrupted file: ${files[i]} — ${msg}`);
    }
  }

  return logs;
}

const DEFAULT_METADATA = {
  model: "unknown",
  tokensUsed: { input: 0, output: 0 },
  toolCalls: 0,
  executionTime: 0,
} as const;

/**
 * Map a DB row to a DailyReportLog domain object.
 */
function dbRowToDailyReportLog(
  row: typeof dailyReports.$inferSelect,
): DailyReportLog {
  return {
    date: row.reportDate,
    reportedSymbols: row.reportedSymbols,
    marketSummary: row.marketSummary,
    metadata: row.metadata ?? DEFAULT_METADATA,
  };
}

/**
 * Read report logs from DB for the last N entries.
 * Returns an array of logs, most recent first.
 */
export async function readReportLogsFromDb(
  daysBack: number,
): Promise<DailyReportLog[]> {
  const rows = await db
    .select()
    .from(dailyReports)
    .orderBy(desc(dailyReports.reportDate))
    .limit(daysBack);

  return rows.map(dbRowToDailyReportLog);
}

/**
 * Read a single report by date from DB.
 * Returns null if not found.
 */
export async function readReportByDate(
  reportDate: string,
): Promise<DailyReportLog | null> {
  const rows = await db
    .select()
    .from(dailyReports)
    .where(eq(dailyReports.reportDate, reportDate))
    .limit(1);

  const row = rows[0];
  if (row == null) {
    return null;
  }

  return dbRowToDailyReportLog(row);
}

/**
 * Save a daily report log to both file (backup) and DB.
 * File save is synchronous (existing behavior). DB save is async.
 * DB errors are logged but do not throw — file backup ensures no data loss.
 */
export async function saveReportLog(data: DailyReportLog): Promise<void> {
  // 1. File backup (synchronous, always succeeds or throws)
  saveReportLogToFile(data);

  // 2. DB save (async, errors are caught and logged)
  try {
    await db
      .insert(dailyReports)
      .values({
        reportDate: data.date,
        type: "daily",
        reportedSymbols: data.reportedSymbols,
        marketSummary: data.marketSummary,
        metadata: data.metadata ?? null,
      })
      .onConflictDoNothing({
        target: [dailyReports.reportDate, dailyReports.type],
      });
    logger.info("ReportLog", `DB saved: ${data.date}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown error";
    logger.warn("ReportLog", `DB save failed (file backup exists): ${msg}`);
  }
}

/**
 * Save a daily report log as JSON file only.
 * Used internally and by the migration script.
 */
export function saveReportLogToFile(data: DailyReportLog): void {
  ensureDir();
  const filePath = reportPath(data.date);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  logger.info("ReportLog", `File saved: ${filePath}`);
}
