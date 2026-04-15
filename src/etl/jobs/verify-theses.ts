import "dotenv/config";
import { pool } from "@/db/client";
import { resolveOrExpireStaleTheses, expireStalledTheses } from "@/debate/thesisStore";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { logger } from "@/lib/logger";

const TAG = "VERIFY_THESES";

/**
 * Thesis 만료 처리 ETL (독립 실행 가능).
 *
 * debate pipeline(run-debate-agent.ts)과 독립적으로 실행되는 안전망.
 * pipeline 실패 시에도 stale thesis가 ACTIVE 상태로 체류하지 않도록 보장한다.
 *
 * 처리 순서:
 * 1. timeframe 100% 초과 thesis → EXPIRED (정량 판정 시도 없음 — snapshot 미제공)
 * 2. 진행률 50%+ 무판정 thesis → EXPIRED (안전망)
 */
async function main() {
  assertValidEnvironment();

  const today = new Date().toISOString().slice(0, 10);
  logger.info(TAG, `Thesis 만료 처리 시작 — date: ${today}`);

  // 1. timeframe 초과 thesis → EXPIRED (snapshot 없이 호출 → 정량 판정 불가 → 일괄 EXPIRED)
  const staleResult = await resolveOrExpireStaleTheses(today);

  // 2. 진행률 50%+ 무판정 thesis → EXPIRED (안전망)
  const stalledCount = await expireStalledTheses(today);

  const totalExpired = staleResult.expired + stalledCount;

  if (totalExpired > 0) {
    logger.info(
      TAG,
      `처리 완료: ${staleResult.expired}개 timeframe 만료, ${stalledCount}개 stale 안전망 만료`,
    );
  } else {
    logger.info(TAG, "만료 대상 thesis 없음");
  }

  await pool.end();
}

main().catch(async (err) => {
  logger.error(TAG, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});
