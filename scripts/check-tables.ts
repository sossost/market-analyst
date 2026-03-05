import "dotenv/config";
import { pool } from "@/db/client";

async function main() {
  const res = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  console.log(`Total tables: ${res.rows.length}`);
  for (const row of res.rows) {
    console.log(`  - ${row.tablename}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
