/**
 * Shell Companies(SPAC) 비활성화 스크립트.
 *
 * FMP industry = 'Shell Companies'인 심볼을 is_actively_trading = false로 변경.
 * 다음 ETL 사이클에서 관련 phase/RS 데이터가 자동으로 제외된다.
 *
 * Usage:
 *   npx tsx scripts/deactivate-shell-companies.ts            # 실행
 *   npx tsx scripts/deactivate-shell-companies.ts --dry-run   # 확인만
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";

const TAG = "DEACTIVATE_SHELL_COMPANIES";

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  const { rows: targets } = await pool.query<{ symbol: string; industry: string }>(
    `SELECT symbol, industry FROM symbols
     WHERE industry = 'Shell Companies' AND is_actively_trading = true
     ORDER BY symbol`,
  );

  console.log(`[${TAG}] Found ${targets.length} active Shell Companies`);

  if (targets.length === 0) {
    console.log(`[${TAG}] Nothing to do.`);
    return;
  }

  for (const t of targets.slice(0, 10)) {
    console.log(`  → ${t.symbol}`);
  }
  if (targets.length > 10) {
    console.log(`  ... and ${targets.length - 10} more`);
  }

  if (isDryRun) {
    console.log(`[${TAG}] Dry run — no changes made.`);
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE symbols SET is_actively_trading = false
     WHERE industry = 'Shell Companies' AND is_actively_trading = true`,
  );

  console.log(`[${TAG}] Deactivated ${rowCount} Shell Companies symbols.`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[${TAG}] Failed:`, error instanceof Error ? error.message : String(error));
    await pool.end();
    process.exit(1);
  });
