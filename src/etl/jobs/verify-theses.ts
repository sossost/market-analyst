import "dotenv/config";
import { db, pool } from "@/db/client";
import { theses } from "@/db/schema/analyst";
import { eq, and, lte, sql } from "drizzle-orm";
import { assertValidEnvironment } from "@/etl/utils/validation";

/**
 * Thesis 검증 ETL.
 *
 * 흐름:
 * 1. ACTIVE thesis 중 timeframe 도래한 건 조회
 * 2. 만료된 thesis → EXPIRED 처리
 *
 * Note: 실제 시장 데이터 대조 검증은 Phase 2에서 추가 예정.
 * 현재는 timeframe 만료 자동 처리만 수행.
 */
async function main() {
  assertValidEnvironment();

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Verify theses — date: ${today}`);

  // 1. ACTIVE thesis 조회
  const activeTheses = await db
    .select()
    .from(theses)
    .where(eq(theses.status, "ACTIVE"));

  if (activeTheses.length === 0) {
    console.log("No active theses. Nothing to verify.");
    await pool.end();
    return;
  }

  console.log(`Active theses: ${activeTheses.length}`);

  let expiredCount = 0;

  // 2. Timeframe 만료 체크
  for (const thesis of activeTheses) {
    const debateDate = new Date(thesis.debateDate);
    const expiryDate = new Date(debateDate);
    expiryDate.setDate(expiryDate.getDate() + thesis.timeframeDays);

    const isExpired = new Date(today) >= expiryDate;

    if (isExpired) {
      await db
        .update(theses)
        .set({
          status: "EXPIRED",
          verificationDate: today,
          closeReason: `Timeframe (${thesis.timeframeDays}일) 만료 — 검증 미완료`,
        })
        .where(eq(theses.id, thesis.id));

      console.log(`  EXPIRED: [${thesis.agentPersona}] ${thesis.thesis.slice(0, 60)}...`);
      expiredCount++;
    }
  }

  console.log(`\nResults: ${expiredCount} expired, ${activeTheses.length - expiredCount} still active`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});
