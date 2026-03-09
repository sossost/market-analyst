/**
 * data/reports/ JSON 파일을 daily_reports 테이블로 이관하는 스크립트.
 *
 * - 기존 JSON 파일을 읽어 DB에 INSERT (ON CONFLICT 시 스킵)
 * - 파일은 삭제하지 않음 (백업 유지)
 * - --dry-run 옵션으로 실제 INSERT 없이 확인 가능
 *
 * Usage:
 *   npx tsx scripts/migrate-reports-to-db.ts
 *   npx tsx scripts/migrate-reports-to-db.ts --dry-run
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../src/db/client.js";
import { dailyReports } from "../src/db/schema/analyst.js";
import type { DailyReportLog } from "../src/types/index.js";

const REPORTS_DIR = path.resolve(process.cwd(), "data/reports");
const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`[migrate-reports] Starting... ${isDryRun ? "(DRY RUN)" : ""}`);

  if (!fs.existsSync(REPORTS_DIR)) {
    console.log("[migrate-reports] No data/reports/ directory found. Nothing to migrate.");
    return;
  }

  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate-reports] No JSON files found. Nothing to migrate.");
    return;
  }

  console.log(`[migrate-reports] Found ${files.length} report file(s).`);

  let inserted = 0;
  let skipped = 0;
  let errored = 0;

  for (const file of files) {
    const filePath = path.join(REPORTS_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const report = JSON.parse(content) as DailyReportLog;

      if (report.date == null || report.date === "") {
        console.warn(`[migrate-reports] Skipping ${file}: missing date field`);
        errored++;
        continue;
      }

      if (isDryRun) {
        console.log(
          `[migrate-reports] (dry-run) Would insert: ${report.date} — ${report.reportedSymbols.length} symbols`,
        );
        inserted++;
        continue;
      }

      await db
        .insert(dailyReports)
        .values({
          reportDate: report.date,
          type: "daily",
          reportedSymbols: report.reportedSymbols,
          marketSummary: report.marketSummary,
          metadata: report.metadata ?? null,
        })
        .onConflictDoNothing({
          target: [dailyReports.reportDate, dailyReports.type],
        });

      console.log(
        `[migrate-reports] Inserted: ${report.date} — ${report.reportedSymbols.length} symbols`,
      );
      inserted++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";

      // Duplicate key = already migrated
      if (msg.includes("uq_daily_reports_date_type")) {
        console.log(`[migrate-reports] Skipped (already exists): ${file}`);
        skipped++;
      } else {
        console.error(`[migrate-reports] Error processing ${file}: ${msg}`);
        errored++;
      }
    }
  }

  console.log(
    `[migrate-reports] Done. Inserted: ${inserted}, Skipped: ${skipped}, Errors: ${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[migrate-reports] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
