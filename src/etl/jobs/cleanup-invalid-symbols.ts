import "dotenv/config";
import { db } from "@/db/client";
import { eq, or, inArray } from "drizzle-orm";
import { symbols } from "@/db/schema/market";
import { isValidTicker } from "@/etl/utils/common";

async function cleanupInvalidSymbols() {
  console.log("🧹 비정상적인 종목들 정리 시작...");

  const allSymbols = await db
    .select({ symbol: symbols.symbol, isEtf: symbols.isEtf, isFund: symbols.isFund })
    .from(symbols);

  const symbolsToDelete = allSymbols
    .filter((s) => !isValidTicker(s.symbol) || s.isEtf || s.isFund)
    .map((s) => s.symbol);

  console.log(
    `🗑️ 삭제할 종목 ${symbolsToDelete.length}개:`,
    symbolsToDelete.slice(0, 10),
  );

  if (symbolsToDelete.length === 0) {
    console.log("✅ 삭제할 비정상 종목이 없습니다.");
    return;
  }

  // Bulk delete in chunks to avoid exceeding parameter limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < symbolsToDelete.length; i += CHUNK_SIZE) {
    const chunk = symbolsToDelete.slice(i, i + CHUNK_SIZE);
    await db.delete(symbols).where(inArray(symbols.symbol, chunk));
  }

  console.log(`✅ ${symbolsToDelete.length}개 비정상 종목 삭제 완료`);
}

cleanupInvalidSymbols().catch((error) => {
  console.error("❌ 정리 작업 실패:", error);
  process.exit(1);
});
