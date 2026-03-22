import "dotenv/config";
import { db, pool } from "@/db/client";
import { newsArchive } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { lt } from "drizzle-orm";
import { logger } from "@/lib/logger";

const TAG = "CLEANUP_NEWS_ARCHIVE";

const RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/**
 * 30일 초과 뉴스 삭제.
 * DB 무한 증가 방지용 정리 잡.
 */
export async function cleanupOldNews(): Promise<number> {
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * MS_PER_DAY);
  const result = await db
    .delete(newsArchive)
    .where(lt(newsArchive.collectedAt, cutoffDate));

  return result.rowCount ?? 0;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  logger.info(TAG, `Cleanup news archive — removing items older than ${RETENTION_DAYS} days`);

  const deletedCount = await cleanupOldNews();

  logger.info(TAG, `Cleanup news archive — done: ${deletedCount} rows deleted`);

  await pool.end();
}

main().catch(async (err) => {
  logger.error(TAG, `cleanup-news-archive failed: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});
