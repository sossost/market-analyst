import fs from "node:fs";
import path from "node:path";
import type { DailyReportLog } from "@/types";

const REPORTS_DIR = path.resolve(process.cwd(), "data/reports");

/**
 * Ensure the reports directory exists.
 */
function ensureDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

/**
 * Get the file path for a given date's report.
 */
function reportPath(date: string): string {
  return path.join(REPORTS_DIR, `${date}.json`);
}

/**
 * Read report logs for the last N days.
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
    } catch {
      // Skip corrupted files
    }
  }

  return logs;
}

/**
 * Save a daily report log as JSON.
 */
export function saveReportLog(data: DailyReportLog): void {
  ensureDir();
  const filePath = reportPath(data.date);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  [ReportLog] Saved: ${filePath}`);
}
