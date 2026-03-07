import "dotenv/config";
import { pool } from "../src/db/client.js";

async function main() {
  const r = await pool.query("SELECT count(*)::int as cnt FROM daily_prices WHERE symbol = 'SPY' AND date >= '2025-09-25'");
  console.log("SPY rows:", r.rows[0]);

  const r2 = await pool.query("SELECT date, close FROM daily_prices WHERE symbol = 'SPY' ORDER BY date DESC LIMIT 3");
  console.log("Recent SPY:", r2.rows);

  await pool.end();
}

main().catch(console.error);
