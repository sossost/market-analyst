import "dotenv/config";
import { pool } from "@/db/client";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { runWatchlistTracking } from "@/lib/watchlistTracker";
import { logger } from "@/lib/logger";

const TAG = "UPDATE_WATCHLIST_TRACKING";

/**
 * 일간 ETL: ACTIVE watchlist의 Phase 궤적을 갱신한다.
 *
 * 흐름:
 * 1. 환경변수 검증
 * 2. 최신 거래일 확인
 * 3. ACTIVE watchlist 전체 조회 (watchlistTracker 내부)
 * 4. 각 종목의 Phase, RS, 가격, 섹터 대비 성과 갱신
 * 5. 90일 초과 종목은 EXITED 처리
 * 6. 개별 종목 실패 시 로그 남기고 계속 처리 (watchlistTracker 내부)
 */
async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping watchlist tracking update.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  const result = await runWatchlistTracking(targetDate);

  logger.info(
    TAG,
    `Done. Total active: ${result.totalActive}, Updated: ${result.updated}, Exited: ${result.exited}`,
  );

  await pool.end();
}

main().catch(async (err) => {
  logger.error(
    TAG,
    `update-watchlist-tracking failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  await pool.end();
  process.exit(1);
});
