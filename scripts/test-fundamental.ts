import "dotenv/config";
import { pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { loadFundamentalData } from "@/lib/fundamental-data-loader";
import { scoreFundamentals, promoteTopToS } from "@/lib/fundamental-scorer";
import { formatFundamentalSupplement } from "@/agent/fundamental/runFundamentalValidation";

async function main() {
  // 1. Phase 2 종목 가져오기
  const rows = await db.execute(sql`
    SELECT DISTINCT symbol
    FROM stock_phases
    WHERE phase = 2
      AND date = (SELECT MAX(date) FROM stock_phases)
    ORDER BY symbol
  `);
  const symbols = (rows.rows as unknown as { symbol: string }[]).map((r) => r.symbol);
  console.log(`\n📊 Phase 2 종목: ${symbols.length}개`);
  console.log(`   샘플: ${symbols.slice(0, 10).join(", ")}${symbols.length > 10 ? "..." : ""}\n`);

  if (symbols.length === 0) {
    console.log("Phase 2 종목 없음 — 종료");
    await pool.end();
    return;
  }

  // 2. DB에서 분기 실적 로드 (500개씩 배치)
  const BATCH_SIZE = 500;
  const inputs = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchInputs = await loadFundamentalData(batch);
    inputs.push(...batchInputs);
    console.log(`   배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batchInputs.length}개 로드`);
  }
  console.log(`📋 실적 데이터 로드: ${inputs.length}개 종목 (${symbols.length - inputs.length}개 실적 없음)\n`);

  // 3. 스코어링
  const scores = promoteTopToS(inputs.map(scoreFundamentals));

  // 4. 등급 분포
  const gradeCount = { S: 0, A: 0, B: 0, C: 0, F: 0 };
  for (const s of scores) gradeCount[s.grade]++;
  console.log(`📈 등급 분포:`);
  console.log(`   S: ${gradeCount.S} | A: ${gradeCount.A} | B: ${gradeCount.B} | C: ${gradeCount.C} | F: ${gradeCount.F}`);
  console.log(`   A급 비율: ${((gradeCount.A + gradeCount.S) / scores.length * 100).toFixed(1)}%\n`);

  // 5. S/A등급 상세
  const topScores = scores.filter((s) => s.grade === "S" || s.grade === "A");
  if (topScores.length > 0) {
    console.log(`⭐ S/A등급 종목:`);
    for (const s of topScores) {
      const eps = s.criteria.epsGrowth;
      const rev = s.criteria.revenueGrowth;
      console.log(`   ${s.grade === "S" ? "⭐" : "🟢"} ${s.symbol} [${s.grade}] rankScore=${s.rankScore} | ${eps.detail} | ${rev.detail}`);
    }
    console.log();
  }

  // 6. B등급
  const bScores = scores.filter((s) => s.grade === "B");
  if (bScores.length > 0) {
    console.log(`🔵 B등급 종목 (${bScores.length}개):`);
    for (const s of bScores.slice(0, 10)) {
      console.log(`   ${s.symbol} — ${s.criteria.epsGrowth.detail} | ${s.criteria.revenueGrowth.detail}`);
    }
    if (bScores.length > 10) console.log(`   ... 외 ${bScores.length - 10}개`);
    console.log();
  }

  // 7. F등급 사유 샘플
  const fScores = scores.filter((s) => s.grade === "F");
  if (fScores.length > 0) {
    console.log(`🔴 F등급 샘플 (상위 5개):`);
    for (const s of fScores.slice(0, 5)) {
      console.log(`   ${s.symbol} — ${s.criteria.epsGrowth.detail} | ${s.criteria.revenueGrowth.detail}`);
    }
    console.log();
  }

  // 8. 보충 텍스트 미리보기
  console.log(`--- 주간 리포트 보충 텍스트 ---`);
  const supplement = formatFundamentalSupplement(scores);
  console.log(supplement.slice(0, 500));
  if (supplement.length > 500) console.log("...(truncated)");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
