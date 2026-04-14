/**
 * 데이터 이관 스크립트: watchlist_stocks -> tracked_stocks
 *
 * 대상:
 *   - watchlist_stocks 테이블의 ACTIVE + EXITED 전체 행
 *
 * 매핑 규칙:
 *   - entry_date          -> entry_date
 *   - price_at_entry      -> entry_price
 *   - entry_phase         -> entry_phase
 *   - entry_rs_score      -> entry_rs_score
 *   - entry_sepa_grade    -> entry_sepa_grade
 *   - entry_thesis_id     -> entry_thesis_id
 *   - entry_sector        -> entry_sector
 *   - entry_industry      -> entry_industry
 *   - entry_reason        -> entry_reason
 *   - phase_trajectory    -> phase_trajectory
 *   - exit_date           -> exit_date
 *   - exit_reason         -> exit_reason
 *   - status: ACTIVE        -> ACTIVE
 *   - status: EXITED        -> EXITED
 *   - source              -> 'agent' (고정)
 *   - tier                -> 'standard' (고정)
 *   - tracking_end_date   -> entry_date + 90일
 *
 * 미이관 필드:
 *   - entry_sector_rs (tracked_stocks에 없음)
 *   - entry_prev_phase (watchlist_stocks에 없음 -> null)
 *
 * 중복 처리:
 *   - recommendations에서 이미 이관된 symbol+entry_date는 ON CONFLICT DO NOTHING
 *   - 여러 번 실행해도 안전 (멱등성 보장)
 *
 * 사용법:
 *   dry-run (기본): npx tsx src/scripts/migrate-watchlist-to-tracked-stocks.ts
 *   실행 모드:       npx tsx src/scripts/migrate-watchlist-to-tracked-stocks.ts --dry-run=false
 */
import "dotenv/config";
import { db, pool } from "../db/client.js";
import { sql } from "drizzle-orm";

const TRACKING_WINDOW_DAYS = 90;
const isDryRun = !process.argv.includes("--dry-run=false");

interface WatchlistRow {
  id: number;
  symbol: string;
  status: string;
  entry_date: string;
  exit_date: string | null;
  exit_reason: string | null;
  entry_phase: number;
  entry_rs_score: number | null;
  entry_sepa_grade: string | null;
  entry_thesis_id: number | null;
  entry_sector: string | null;
  entry_industry: string | null;
  entry_reason: string | null;
  tracking_end_date: string | null;
  current_phase: number | null;
  current_rs_score: number | null;
  phase_trajectory: unknown;
  price_at_entry: string | null;
  current_price: string | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  days_tracked: number | null;
  last_updated: string | null;
}

interface MigrationResult {
  insertedCount: number;
  skippedCount: number;
}

function computeTrackingEndDate(entryDate: string): string {
  const date = new Date(entryDate);
  date.setDate(date.getDate() + TRACKING_WINDOW_DAYS);
  return date.toISOString().slice(0, 10);
}

async function fetchAllWatchlistStocks(): Promise<WatchlistRow[]> {
  const result = await db.execute(sql`
    SELECT
      id,
      symbol,
      status,
      entry_date,
      exit_date,
      exit_reason,
      entry_phase,
      entry_rs_score,
      entry_sepa_grade,
      entry_thesis_id,
      entry_sector,
      entry_industry,
      entry_reason,
      tracking_end_date,
      current_phase,
      current_rs_score,
      phase_trajectory,
      price_at_entry,
      current_price,
      pnl_percent,
      max_pnl_percent,
      days_tracked,
      last_updated
    FROM watchlist_stocks
    ORDER BY entry_date, symbol
  `);
  return result.rows as unknown as WatchlistRow[];
}

async function fetchAgentSourceCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM tracked_stocks WHERE source = 'agent'
  `);
  const rows = result.rows as unknown as Array<{ cnt: string }>;
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

async function fetchTotalTrackedCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM tracked_stocks
  `);
  const rows = result.rows as unknown as Array<{ cnt: string }>;
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

/** 단건 INSERT. ON CONFLICT DO NOTHING으로 중복 및 멱등성 보장. */
async function insertTrackedStock(row: WatchlistRow): Promise<"inserted" | "skipped"> {
  // watchlist_stocks에 tracking_end_date가 이미 있으면 그것을 사용,
  // 없으면 entry_date + 90일로 계산
  const trackingEndDate = row.tracking_end_date ?? computeTrackingEndDate(row.entry_date);

  // entry_price: watchlist는 price_at_entry 컬럼. null이면 스킵
  // (tracked_stocks.entry_price는 NOT NULL, 0은 PnL 계산 불가)
  if (row.price_at_entry == null || row.price_at_entry === "0") {
    console.warn(`  ⚠ ${row.symbol} (${row.entry_date}): price_at_entry 없음 — 스킵`);
    return "skipped";
  }
  const entryPrice = row.price_at_entry;

  const phaseTrajectoryJson =
    row.phase_trajectory != null ? JSON.stringify(row.phase_trajectory) : null;

  const result = await db.execute(sql`
    INSERT INTO tracked_stocks (
      symbol,
      source,
      tier,
      entry_date,
      entry_price,
      entry_phase,
      entry_prev_phase,
      entry_rs_score,
      entry_sepa_grade,
      entry_thesis_id,
      entry_sector,
      entry_industry,
      entry_reason,
      status,
      current_price,
      current_phase,
      current_rs_score,
      pnl_percent,
      max_pnl_percent,
      days_tracked,
      last_updated,
      tracking_end_date,
      phase_trajectory,
      exit_date,
      exit_reason
    ) VALUES (
      ${row.symbol},
      'agent',
      'standard',
      ${row.entry_date},
      ${entryPrice},
      ${row.entry_phase},
      ${null},
      ${row.entry_rs_score},
      ${row.entry_sepa_grade},
      ${row.entry_thesis_id},
      ${row.entry_sector},
      ${row.entry_industry},
      ${row.entry_reason},
      ${row.status},
      ${row.current_price},
      ${row.current_phase},
      ${row.current_rs_score},
      ${row.pnl_percent},
      ${row.max_pnl_percent},
      ${row.days_tracked ?? 0},
      ${row.last_updated},
      ${trackingEndDate},
      ${phaseTrajectoryJson != null ? sql`${phaseTrajectoryJson}::jsonb` : sql`NULL`},
      ${row.exit_date},
      ${row.exit_reason}
    )
    ON CONFLICT (symbol, entry_date) DO NOTHING
  `);

  return (result.rowCount ?? 0) > 0 ? "inserted" : "skipped";
}

async function runMigration(rows: WatchlistRow[]): Promise<MigrationResult> {
  let insertedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const outcome = await insertTrackedStock(row);
    if (outcome === "inserted") {
      insertedCount++;
    } else {
      skippedCount++;
      process.stdout.write(
        `  [SKIP] ${row.symbol} (${row.entry_date}) — 이미 존재 (ON CONFLICT)\n`,
      );
    }
  }

  return { insertedCount, skippedCount };
}

async function main(): Promise<void> {
  const mode = isDryRun ? "DRY-RUN" : "EXECUTE";
  process.stdout.write(`\n=== migrate-watchlist-to-tracked-stocks [${mode}] ===\n\n`);

  if (isDryRun) {
    process.stdout.write(
      "DRY-RUN 모드: 실제 DB 변경 없음. --dry-run=false 플래그로 실행 가능.\n\n",
    );
  }

  const rows = await fetchAllWatchlistStocks();
  const beforeAgentCount = await fetchAgentSourceCount();
  const beforeTotalCount = await fetchTotalTrackedCount();

  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const exitedCount = rows.filter((r) => r.status === "EXITED").length;
  const withTrajectoryCount = rows.filter((r) => r.phase_trajectory != null).length;

  process.stdout.write(`[이관 대상] watchlist_stocks 전체: ${rows.length}건\n`);
  process.stdout.write(`  - ACTIVE:           ${activeCount}건\n`);
  process.stdout.write(`  - EXITED:           ${exitedCount}건\n`);
  process.stdout.write(`  - phase_trajectory: ${withTrajectoryCount}건 (보존 대상)\n`);
  process.stdout.write(`\n[이관 전] tracked_stocks\n`);
  process.stdout.write(`  - 전체:        ${beforeTotalCount}건\n`);
  process.stdout.write(`  - source=agent: ${beforeAgentCount}건\n\n`);

  if (isDryRun) {
    process.stdout.write("--- 이관 미리보기 (처음 5건) ---\n");
    const preview = rows.slice(0, 5);
    for (const row of preview) {
      const trackingEndDate = row.tracking_end_date ?? computeTrackingEndDate(row.entry_date);
      const entryPrice = row.price_at_entry ?? "0";
      process.stdout.write(
        `  ID=${row.id} ${row.symbol} (${row.entry_date})\n` +
          `    status: ${row.status}\n` +
          `    entry_price: ${entryPrice}, entry_phase: ${row.entry_phase}\n` +
          `    tracking_end_date: ${trackingEndDate}\n` +
          `    phase_trajectory: ${row.phase_trajectory != null ? "있음" : "없음"}\n` +
          `    source: agent, tier: standard\n`,
      );
    }
    if (rows.length > 5) {
      process.stdout.write(`  ... 외 ${rows.length - 5}건\n`);
    }

    process.stdout.write(
      "\n[DRY-RUN 완료] 위 내용을 반영하려면 --dry-run=false 플래그로 재실행하세요.\n",
    );
    await pool.end();
    return;
  }

  // 실행 모드: 이관
  process.stdout.write("--- 이관 시작 ---\n");
  const { insertedCount, skippedCount } = await runMigration(rows);

  // 이관 후 건수 검증
  const afterAgentCount = await fetchAgentSourceCount();
  const afterTotalCount = await fetchTotalTrackedCount();
  const actualNew = afterAgentCount - beforeAgentCount;

  process.stdout.write(`\n=== 이관 완료 ===\n`);
  process.stdout.write(`  INSERT 성공:      ${insertedCount}건\n`);
  process.stdout.write(`  SKIP (중복):      ${skippedCount}건\n`);
  process.stdout.write(`\n[이관 후] tracked_stocks\n`);
  process.stdout.write(`  - 전체:        ${afterTotalCount}건 (증가: ${afterTotalCount - beforeTotalCount}건)\n`);
  process.stdout.write(`  - source=agent: ${afterAgentCount}건 (증가: ${actualNew}건)\n`);

  if (insertedCount !== actualNew) {
    process.stderr.write(
      `\n[경고] 건수 불일치: 카운터 기준=${insertedCount}, DB 실측=${actualNew}\n`,
    );
  } else {
    process.stdout.write(`\n[검증 통과] 이관 건수 일치 확인\n`);
  }

  // phase_trajectory 보존 검증: ACTIVE 이관 건 중 trajectory가 있어야 할 것들 확인
  const activeWithTrajectory = rows.filter(
    (r) => r.status === "ACTIVE" && r.phase_trajectory != null,
  );
  if (activeWithTrajectory.length > 0) {
    const verificationResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM tracked_stocks
      WHERE source = 'agent'
        AND status = 'ACTIVE'
        AND phase_trajectory IS NOT NULL
    `);
    const verRows = verificationResult.rows as unknown as Array<{ cnt: string }>;
    const trackedWithTrajectory = parseInt(verRows[0]?.cnt ?? "0", 10);
    process.stdout.write(
      `\n[phase_trajectory 검증]\n` +
        `  watchlist ACTIVE + trajectory 있음: ${activeWithTrajectory.length}건\n` +
        `  tracked_stocks ACTIVE + trajectory 있음: ${trackedWithTrajectory}건\n`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  process.stderr.write(`오류: ${String(e)}\n`);
  process.exit(1);
});
