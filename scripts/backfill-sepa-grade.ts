/**
 * entry_sepa_grade NULL 백필 스크립트.
 *
 * tracked_stocks에서 entry_sepa_grade가 NULL인 레코드를 찾아,
 * fundamental_scores 테이블에서 entry_date 기준 가장 최근 등급으로 채운다.
 * S/A 등급으로 채워진 standard tier 종목은 featured로 승격한다.
 *
 * Usage:
 *   npx tsx scripts/backfill-sepa-grade.ts
 *   npx tsx scripts/backfill-sepa-grade.ts --dry-run
 *
 * Issue #972
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";

// ── 타입 ──

interface NullGradeRow {
  id: number;
  symbol: string;
  entry_date: string;
  tier: string;
}

interface BackfillResult {
  id: number;
  symbol: string;
  grade: string;
}

interface TierUpdateResult {
  id: number;
  symbol: string;
  old_tier: string;
  new_tier: string;
}

// ── 핵심 로직 (테스트 가능) ──

/** S/A 등급이면서 standard tier인 경우 featured로 승격 */
export function shouldUpgradeTier(
  grade: string | null,
  currentTier: string,
): boolean {
  if (grade == null) return false;
  return ["S", "A"].includes(grade) && currentTier === "standard";
}

// ── DB 쿼리 ──

/** entry_sepa_grade가 NULL인 tracked_stocks 조회 */
async function findNullGradeRows(): Promise<NullGradeRow[]> {
  const { rows } = await pool.query<NullGradeRow>(
    `SELECT id, symbol, entry_date, tier
     FROM tracked_stocks
     WHERE entry_sepa_grade IS NULL`,
  );
  return rows;
}

/**
 * NULL 레코드를 fundamental_scores에서 백필한다.
 * 양방향 LATERAL JOIN: entry_date 이전 최근 grade 우선, 없으면 이후 가장 가까운 grade로 fallback.
 * after fallback은 entry 시점에 아직 없던 스코어를 소급 적용하므로 정확도가 낮을 수 있으나,
 * NULL 방치보다 팩터 슬라이싱 품질에 유리하다.
 * 반환: 실제 UPDATE된 행 목록.
 */
async function backfillGrades(
  client: { query: typeof pool.query },
): Promise<BackfillResult[]> {
  const { rows } = await client.query<BackfillResult>(
    `UPDATE tracked_stocks ts
     SET entry_sepa_grade = fs.grade
     FROM (
       SELECT ts2.id, COALESCE(before.grade, after.grade) AS grade
       FROM tracked_stocks ts2
       LEFT JOIN LATERAL (
         SELECT grade
         FROM fundamental_scores
         WHERE symbol = ts2.symbol
           AND scored_date <= ts2.entry_date
           AND grade IS NOT NULL AND grade != ''
         ORDER BY scored_date DESC
         LIMIT 1
       ) before ON true
       LEFT JOIN LATERAL (
         SELECT grade
         FROM fundamental_scores
         WHERE symbol = ts2.symbol
           AND scored_date > ts2.entry_date
           AND grade IS NOT NULL AND grade != ''
         ORDER BY scored_date ASC
         LIMIT 1
       ) after ON true
       WHERE ts2.entry_sepa_grade IS NULL
         AND COALESCE(before.grade, after.grade) IS NOT NULL
     ) fs
     WHERE ts.id = fs.id
     RETURNING ts.id, ts.symbol, ts.entry_sepa_grade AS grade`,
  );
  return rows;
}

/**
 * 백필된 종목 중 S/A 등급 + standard tier인 것만 featured로 승격.
 * backfilledIds 범위로 제한하여 기존 데이터를 건드리지 않는다.
 */
async function upgradeTiers(
  client: { query: typeof pool.query },
  backfilledIds: number[],
): Promise<TierUpdateResult[]> {
  if (backfilledIds.length === 0) return [];

  const { rows } = await client.query<TierUpdateResult>(
    `UPDATE tracked_stocks
     SET tier = 'featured'
     WHERE id = ANY($1::int[])
       AND entry_sepa_grade IN ('S', 'A')
       AND tier = 'standard'
     RETURNING id, symbol, 'standard' AS old_tier, 'featured' AS new_tier`,
    [backfilledIds],
  );
  return rows;
}

// ── 메인 ──

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("=== entry_sepa_grade 백필 (#972) ===");
  if (dryRun) console.log("  (DRY RUN — DB 변경 없음)");

  // 1. 현황 파악
  const nullRows = await findNullGradeRows();
  console.log(`\nentry_sepa_grade NULL: ${nullRows.length}건`);

  if (nullRows.length === 0) {
    console.log("백필할 대상 없음.");
    await pool.end();
    return;
  }

  // 2. 매칭 가능 건수 미리 확인
  const { rows: matchableRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
     FROM tracked_stocks ts
     WHERE ts.entry_sepa_grade IS NULL
       AND EXISTS (
         SELECT 1 FROM fundamental_scores fs
         WHERE fs.symbol = ts.symbol
           AND fs.grade IS NOT NULL
           AND fs.grade != ''
       )`,
  );
  const matchableCount = parseInt(matchableRows[0].cnt, 10);
  console.log(`fundamental_scores 매칭 가능: ${matchableCount}건`);
  console.log(`매칭 불가 (데이터 없음): ${nullRows.length - matchableCount}건`);

  if (matchableCount === 0) {
    console.log("매칭 가능한 레코드 없음.");
    await pool.end();
    return;
  }

  if (dryRun) {
    console.log("\n[DRY RUN] 실제 DB 변경 없이 종료합니다.");
    await pool.end();
    return;
  }

  // 3. 트랜잭션으로 백필 + tier 승격 원자 실행
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 3a. 백필 실행
    console.log("\n백필 실행 중...");
    const backfilled = await backfillGrades(client);
    console.log(`백필 완료: ${backfilled.length}건 UPDATE`);

    // 등급별 분포
    const gradeDist = new Map<string, number>();
    for (const row of backfilled) {
      gradeDist.set(row.grade, (gradeDist.get(row.grade) ?? 0) + 1);
    }
    console.log("\n백필된 등급 분포:");
    for (const [grade, count] of [...gradeDist.entries()].sort()) {
      console.log(`  ${grade}: ${count}건`);
    }

    // 3b. tier 승격 (백필된 ID만 대상)
    const backfilledIds = backfilled.map((r) => r.id);
    const tierUpdates = await upgradeTiers(client, backfilledIds);
    if (tierUpdates.length > 0) {
      console.log(
        `\ntier 승격: ${tierUpdates.length}건 (standard → featured)`,
      );
      for (const t of tierUpdates) {
        console.log(`  ${t.symbol}: ${t.old_tier} → ${t.new_tier}`);
      }
    } else {
      console.log("\ntier 승격 대상 없음.");
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // 4. 최종 현황
  const { rows: finalRows } = await pool.query<{
    entry_sepa_grade: string | null;
    cnt: string;
  }>(
    `SELECT entry_sepa_grade, COUNT(*) AS cnt
     FROM tracked_stocks
     GROUP BY entry_sepa_grade
     ORDER BY entry_sepa_grade NULLS LAST`,
  );
  console.log("\n최종 entry_sepa_grade 분포:");
  for (const r of finalRows) {
    console.log(`  ${r.entry_sepa_grade ?? "NULL"}: ${r.cnt}건`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(
    "Backfill failed:",
    err instanceof Error ? err.message : String(err),
  );
  await pool.end();
  process.exit(1);
});
