import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db/client";

async function main() {
  const rows = await db.execute(sql`
    SELECT symbol, period_end_date, as_of_q, eps_diluted, revenue
    FROM quarterly_financials
    WHERE symbol = 'NVDA'
    ORDER BY period_end_date DESC
    LIMIT 10
  `);
  console.log("NVDA quarterly_financials:");
  for (const r of rows.rows as any[]) {
    console.log(`  ${r.as_of_q} | ${r.period_end_date} | EPS: ${r.eps_diluted} | Rev: ${r.revenue}`);
  }

  // Also check a C-grade stock
  const rows2 = await db.execute(sql`
    SELECT symbol, period_end_date, as_of_q, eps_diluted, revenue
    FROM quarterly_financials
    WHERE symbol = 'ADI'
    ORDER BY period_end_date DESC
    LIMIT 10
  `);
  console.log("\nADI quarterly_financials:");
  for (const r of rows2.rows as any[]) {
    console.log(`  ${r.as_of_q} | ${r.period_end_date} | EPS: ${r.eps_diluted} | Rev: ${r.revenue}`);
  }

  await pool.end();
}

main().catch(console.error);
