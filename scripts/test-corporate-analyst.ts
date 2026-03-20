import "dotenv/config";
import { Pool } from "pg";
import { runCorporateAnalyst } from "@/agent/corporateAnalyst/runCorporateAnalyst.js";

const symbol = process.argv[2] ?? "VICR";
const date = process.argv[3] ?? "2026-03-14";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log(`[TEST] ${symbol} (${date}) 리포트 생성 시작...`);
  const result = await runCorporateAnalyst(symbol, date, pool);
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}
main();
