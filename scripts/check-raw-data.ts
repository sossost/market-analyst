import "dotenv/config";
import { pool } from "../src/db/client.js";

async function main() {
  const tables = ["daily_prices", "daily_ma", "daily_ratios", "quarterly_financials"];

  for (const table of tables) {
    try {
      const r = await pool.query(`SELECT min(date) as min_date, max(date) as max_date, count(distinct date)::int as days FROM ${table}`);
      console.log(`${table}:`, r.rows[0]);
    } catch (err) {
      console.log(`${table}: table not found or error`);
    }
  }

  // Check symbols count
  const r = await pool.query("SELECT count(*)::int as count FROM symbols WHERE is_active = true");
  console.log("active symbols:", r.rows[0]);

  await pool.end();
}

main().catch(console.error);
