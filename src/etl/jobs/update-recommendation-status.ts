import "dotenv/config";
import { db, pool } from "@/db/client";
import { recommendations } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { eq, sql } from "drizzle-orm";

/**
 * 일간 ETL: ACTIVE 추천 종목의 성과를 업데이트한다.
 *
 * 흐름:
 * 1. 최신 거래일 확인
 * 2. ACTIVE 추천 조회
 * 3. 각 종목의 현재 종가/Phase/RS 조회
 * 4. PnL, maxPnl, daysHeld 계산
 * 5. Phase 2 이탈 시 CLOSED_PHASE_EXIT 처리
 */
async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    console.log("No trade date found. Skipping recommendation update.");
    await pool.end();
    return;
  }

  console.log(`Target date: ${targetDate}`);

  // 1. ACTIVE 추천 조회
  const activeRecs = await retryDatabaseOperation(() =>
    db
      .select()
      .from(recommendations)
      .where(eq(recommendations.status, "ACTIVE")),
  );

  if (activeRecs.length === 0) {
    console.log("No active recommendations. Nothing to update.");
    await pool.end();
    return;
  }

  console.log(`Active recommendations: ${activeRecs.length}`);

  const symbols = activeRecs.map((r) => r.symbol);

  // 2. 현재 종가 + Phase/RS 조회 (JOIN으로 단일 쿼리)
  const { rows: dataRows } = await retryDatabaseOperation(() =>
    pool.query<{
      symbol: string;
      close: string;
      phase: number | null;
      rs_score: number | null;
    }>(
      `SELECT p.symbol, p.close::text, sp.phase, sp.rs_score
       FROM daily_prices p
       LEFT JOIN stock_phases sp ON p.symbol = sp.symbol AND p.date = sp.date
       WHERE p.symbol = ANY($1) AND p.date = $2`,
      [symbols, targetDate],
    ),
  );
  const dataBySymbol = new Map(
    dataRows.map((r) => [
      r.symbol,
      { price: toNum(r.close), phase: r.phase, rs: r.rs_score },
    ]),
  );

  // 4. 각 추천 업데이트
  let closedCount = 0;

  for (const rec of activeRecs) {
    const data = dataBySymbol.get(rec.symbol);
    if (data == null || data.price === 0) continue;

    const currentPrice = data.price;
    const currentPhase = data.phase ?? null;
    const currentRs = data.rs ?? null;

    const entryPrice = toNum(rec.entryPrice);
    if (entryPrice === 0) continue;

    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const prevMaxPnl = toNum(rec.maxPnlPercent);
    const maxPnlPercent = Math.max(prevMaxPnl, pnlPercent);
    const daysHeld = (rec.daysHeld ?? 0) + 1;

    // Phase 2 이탈 체크
    const isPhaseExit = currentPhase != null && currentPhase !== 2;

    await retryDatabaseOperation(() =>
      db
        .update(recommendations)
        .set({
          currentPrice: String(currentPrice),
          currentPhase: currentPhase,
          currentRsScore: currentRs,
          pnlPercent: String(pnlPercent),
          maxPnlPercent: String(maxPnlPercent),
          daysHeld,
          lastUpdated: targetDate,
          ...(isPhaseExit
            ? {
                status: "CLOSED_PHASE_EXIT",
                closeDate: targetDate,
                closePrice: String(currentPrice),
                closeReason: `Phase ${currentPhase} 이탈 (RS ${currentRs ?? "N/A"})`,
              }
            : {}),
        })
        .where(eq(recommendations.id, rec.id)),
    );

    if (isPhaseExit) closedCount++;
  }

  console.log(
    `Done. Updated: ${activeRecs.length}, Closed today: ${closedCount}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("update-recommendation-status failed:", err);
  pool.end();
  process.exit(1);
});
