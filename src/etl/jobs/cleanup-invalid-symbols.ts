import "dotenv/config";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

async function cleanupInvalidSymbols() {
  console.log("🧹 비정상적인 종목들 정리 시작...");

  const invalidSymbols = await db.execute(sql`
    SELECT symbol
    FROM symbols
    WHERE
      symbol !~ '^[A-Z]{1,5}$' OR
      symbol LIKE '%W' OR
      symbol LIKE '%X' OR
      symbol LIKE '%.%' OR
      symbol LIKE '%U' OR
      symbol LIKE '%WS' OR
      is_etf = true OR
      is_fund = true
  `);

  const symbolsToDelete = (invalidSymbols.rows as Record<string, unknown>[]).map(
    (r) => r.symbol as string,
  );
  console.log(
    `🗑️ 삭제할 종목 ${symbolsToDelete.length}개:`,
    symbolsToDelete.slice(0, 10),
  );

  if (symbolsToDelete.length === 0) {
    console.log("✅ 삭제할 비정상 종목이 없습니다.");
    return;
  }

  for (const symbol of symbolsToDelete) {
    await db.execute(sql`DELETE FROM symbols WHERE symbol = ${symbol}`);
  }

  console.log(`✅ ${symbolsToDelete.length}개 비정상 종목 삭제 완료`);
}

cleanupInvalidSymbols().catch((error) => {
  console.error("❌ 정리 작업 실패:", error);
  process.exit(1);
});
