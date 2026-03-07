import "dotenv/config";
import { db, pool } from "../src/db/client.js";
import { stockPhases, sectorRsDaily, industryRsDaily } from "../src/db/schema/analyst.js";
import { sql } from "drizzle-orm";

async function main() {
  const [phases] = await db.select({
    minDate: sql<string>`min(date)`,
    maxDate: sql<string>`max(date)`,
    count: sql<number>`count(distinct date)::int`,
  }).from(stockPhases);

  const [sectors] = await db.select({
    minDate: sql<string>`min(date)`,
    maxDate: sql<string>`max(date)`,
    count: sql<number>`count(distinct date)::int`,
  }).from(sectorRsDaily);

  const [industries] = await db.select({
    minDate: sql<string>`min(date)`,
    maxDate: sql<string>`max(date)`,
    count: sql<number>`count(distinct date)::int`,
  }).from(industryRsDaily);

  console.log("stock_phases:", phases);
  console.log("sector_rs_daily:", sectors);
  console.log("industry_rs_daily:", industries);

  // Check sample dates around 3 months ago
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const checkDate = threeMonthsAgo.toISOString().slice(0, 10);

  const [nearDate] = await db.select({
    closestDate: sql<string>`min(date)`,
  }).from(stockPhases).where(sql`date >= ${checkDate}`);

  console.log(`\n3 months ago (~${checkDate}): closest data = ${nearDate?.closestDate}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
