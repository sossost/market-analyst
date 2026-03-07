import "dotenv/config";
import { pool } from "@/db/client";

async function main() {
  // 1. Recent dates
  const { rows: dates } = await pool.query(
    "SELECT DISTINCT date FROM stock_phases ORDER BY date DESC LIMIT 10"
  );
  console.log("Recent dates:", dates.map((r: any) => r.date));

  // 2. AAOI RS trend
  const { rows: aaoi } = await pool.query(
    "SELECT date, rs_score, phase, pct_from_high_52w::text FROM stock_phases WHERE symbol = 'AAOI' ORDER BY date DESC LIMIT 10"
  );
  console.log("\nAAOI recent:");
  for (const r of aaoi) console.log(`  ${r.date}: RS=${r.rs_score}, Phase=${r.phase}, fromHigh=${r.pct_from_high_52w}`);

  // 3. LITE RS trend
  const { rows: lite } = await pool.query(
    "SELECT date, rs_score, phase, pct_from_high_52w::text FROM stock_phases WHERE symbol = 'LITE' ORDER BY date DESC LIMIT 10"
  );
  console.log("\nLITE recent:");
  for (const r of lite) console.log(`  ${r.date}: RS=${r.rs_score}, Phase=${r.phase}, fromHigh=${r.pct_from_high_52w}`);

  // 4. Check if we have daily_prices for recent momentum
  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%price%' OR table_name LIKE '%daily%' ORDER BY table_name"
  );
  console.log("\nPrice-related tables:", tables.map((r: any) => r.table_name));

  await pool.end();
}

main().catch(console.error);
