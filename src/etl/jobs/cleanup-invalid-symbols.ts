import "dotenv/config";
import { db } from "@/db/client";
import { eq, or, inArray } from "drizzle-orm";
import { symbols } from "@/db/schema/market";
import { isValidTicker } from "@/etl/utils/common";
import { logger } from "@/agent/logger";

const TAG = "CLEANUP_INVALID_SYMBOLS";

async function cleanupInvalidSymbols() {
  logger.info(TAG, "비정상적인 종목들 정리 시작...");

  const allSymbols = await db
    .select({ symbol: symbols.symbol, isEtf: symbols.isEtf, isFund: symbols.isFund })
    .from(symbols);

  const symbolsToDelete = allSymbols
    .filter((s) => !isValidTicker(s.symbol) || s.isEtf || s.isFund)
    .map((s) => s.symbol);

  logger.info(
    TAG,
    `삭제할 종목 ${symbolsToDelete.length}개: ${JSON.stringify(symbolsToDelete.slice(0, 10))}`,
  );

  if (symbolsToDelete.length === 0) {
    logger.info(TAG, "삭제할 비정상 종목이 없습니다.");
    return;
  }

  // Bulk delete in chunks to avoid exceeding parameter limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < symbolsToDelete.length; i += CHUNK_SIZE) {
    const chunk = symbolsToDelete.slice(i, i + CHUNK_SIZE);
    await db.delete(symbols).where(inArray(symbols.symbol, chunk));
  }

  logger.info(TAG, `${symbolsToDelete.length}개 비정상 종목 삭제 완료`);
}

cleanupInvalidSymbols().catch((error) => {
  logger.error(TAG, `정리 작업 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
