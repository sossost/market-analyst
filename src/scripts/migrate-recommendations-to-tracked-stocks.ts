/**
 * 데이터 이관 스크립트: recommendations -> tracked_stocks
 *
 * 대상:
 *   - recommendations 테이블의 ACTIVE + CLOSED_* 전체 행
 *
 * 매핑 규칙:
 *   - recommendation_date -> entry_date
 *   - entry_price         -> entry_price (그대로)
 *   - entry_phase         -> entry_phase
 *   - entry_prev_phase    -> entry_prev_phase
 *   - entry_rs_score      -> entry_rs_score
 *   - sector              -> entry_sector
 *   - industry            -> entry_industry
 *   - reason              -> entry_reason
 *   - market_regime       -> market_regime
 *   - close_date          -> exit_date
 *   - close_reason        -> exit_reason
 *   - status: ACTIVE        -> ACTIVE
 *   - status: CLOSED_*      -> EXITED
 *   - source              -> 'etl_auto' (고정)
 *   - tier                -> 'standard' (고정)
 *   - tracking_end_date   -> entry_date + 90일
 *
 * 미이관 필드 (trailing stop 관련):
 *   - failure_conditions, phase2_revert_date, max_adverse_move
 *   - close_price (exit_price 컬럼 없음)
 *
 * 멱등성:
 *   - (symbol, entry_date) UNIQUE 제약으로 ON CONFLICT DO NOTHING
 *   - 여러 번 실행해도 안전
 *
 * 사용법:
 *   dry-run (기본): npx tsx src/scripts/migrate-recommendations-to-tracked-stocks.ts
 *   실행 모드:       npx tsx src/scripts/migrate-recommendations-to-tracked-stocks.ts --dry-run=false
 */
import "dotenv/config";
import type { PoolClient } from "pg";
import { db, pool } from "../db/client.js";
import { sql } from "drizzle-orm";

const TRACKING_WINDOW_DAYS = 90;
const isDryRun = !process.argv.includes("--dry-run=false");

interface RecommendationRow {
  id: number;
  symbol: string;
  recommendation_date: string;
  entry_price: string;
  entry_rs_score: number | null;
  entry_phase: number;
  entry_prev_phase: number | null;
  sector: string | null;
  industry: string | null;
  reason: string | null;
  status: string;
  market_regime: string | null;
  current_price: string | null;
  current_phase: number | null;
  current_rs_score: number | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
  days_held: number | null;
  last_updated: string | null;
  close_date: string | null;
  close_reason: string | null;
}

interface MigrationResult {
  insertedCount: number;
  skippedCount: number;
}

function mapStatus(recommendationStatus: string): string {
  if (recommendationStatus === "ACTIVE") {
    return "ACTIVE";
  }
  // CLOSED_TRAILING_STOP, CLOSED_HARD_STOP, CLOSED_PHASE_EXIT, CLOSED 등 모두 EXITED
  return "EXITED";
}

function computeTrackingEndDate(entryDate: string): string {
  const date = new Date(entryDate);
  date.setDate(date.getDate() + TRACKING_WINDOW_DAYS);
  return date.toISOString().slice(0, 10);
}

async function fetchAllRecommendations(): Promise<RecommendationRow[]> {
  const result = await db.execute(sql`
    SELECT
      id,
      symbol,
      recommendation_date,
      entry_price,
      entry_rs_score,
      entry_phase,
      entry_prev_phase,
      sector,
      industry,
      reason,
      status,
      market_regime,
      current_price,
      current_phase,
      current_rs_score,
      pnl_percent,
      max_pnl_percent,
      days_held,
      last_updated,
      close_date,
      close_reason
    FROM recommendations
    ORDER BY recommendation_date, symbol
  `);
  return result.rows as unknown as RecommendationRow[];
}

async function fetchEtlAutoCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM tracked_stocks WHERE source = 'etl_auto'
  `);
  const rows = result.rows as unknown as Array<{ cnt: string }>;
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

/** 단건 INSERT. ON CONFLICT DO NOTHING으로 멱등성 보장. */
async function insertTrackedStock(
  rec: RecommendationRow,
  client: PoolClient,
): Promise<"inserted" | "skipped"> {
  const entryDate = rec.recommendation_date;
  const trackingEndDate = computeTrackingEndDate(entryDate);
  const mappedStatus = mapStatus(rec.status);

  const result = await client.query(
    `INSERT INTO tracked_stocks (
      symbol, source, tier, entry_date, entry_price,
      entry_phase, entry_prev_phase, entry_rs_score,
      entry_sector, entry_industry, entry_reason, status,
      market_regime, current_price, current_phase, current_rs_score,
      pnl_percent, max_pnl_percent, days_tracked, last_updated,
      tracking_end_date, exit_date, exit_reason
    ) VALUES (
      $1, 'etl_auto', 'standard', $2, $3,
      $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15, $16, $17, $18,
      $19, $20, $21
    )
    ON CONFLICT (symbol, entry_date) DO NOTHING`,
    [
      rec.symbol, entryDate, rec.entry_price,
      rec.entry_phase, rec.entry_prev_phase, rec.entry_rs_score,
      rec.sector, rec.industry, rec.reason, mappedStatus,
      rec.market_regime, rec.current_price, rec.current_phase, rec.current_rs_score,
      rec.pnl_percent, rec.max_pnl_percent, rec.days_held ?? 0, rec.last_updated,
      trackingEndDate, rec.close_date, rec.close_reason,
    ],
  );

  return (result.rowCount ?? 0) > 0 ? "inserted" : "skipped";
}

async function runMigration(recs: RecommendationRow[]): Promise<MigrationResult> {
  let insertedCount = 0;
  let skippedCount = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const rec of recs) {
      const outcome = await insertTrackedStock(rec, client);
      if (outcome === "inserted") {
        insertedCount++;
      } else {
        skippedCount++;
        process.stdout.write(
          `  [SKIP] ${rec.symbol} (${rec.recommendation_date}) — 이미 존재 (ON CONFLICT)\n`,
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { insertedCount, skippedCount };
}

async function main(): Promise<void> {
  const mode = isDryRun ? "DRY-RUN" : "EXECUTE";
  process.stdout.write(`\n=== migrate-recommendations-to-tracked-stocks [${mode}] ===\n\n`);

  if (isDryRun) {
    process.stdout.write(
      "DRY-RUN 모드: 실제 DB 변경 없음. --dry-run=false 플래그로 실행 가능.\n\n",
    );
  }

  const recs = await fetchAllRecommendations();
  const beforeCount = await fetchEtlAutoCount();

  const activeCount = recs.filter((r) => r.status === "ACTIVE").length;
  const closedCount = recs.filter((r) => r.status !== "ACTIVE").length;

  process.stdout.write(`[이관 대상] recommendations 전체: ${recs.length}건\n`);
  process.stdout.write(`  - ACTIVE:    ${activeCount}건\n`);
  process.stdout.write(`  - CLOSED_*:  ${closedCount}건 (-> EXITED)\n`);
  process.stdout.write(`\n[이관 전] tracked_stocks (source=etl_auto): ${beforeCount}건\n\n`);

  if (isDryRun) {
    process.stdout.write("--- 이관 미리보기 (처음 5건) ---\n");
    const preview = recs.slice(0, 5);
    for (const rec of preview) {
      const mappedStatus = mapStatus(rec.status);
      const trackingEndDate = computeTrackingEndDate(rec.recommendation_date);
      process.stdout.write(
        `  ID=${rec.id} ${rec.symbol} (${rec.recommendation_date})\n` +
          `    status: ${rec.status} -> ${mappedStatus}\n` +
          `    entry_price: ${rec.entry_price}, entry_phase: ${rec.entry_phase}\n` +
          `    tracking_end_date: ${trackingEndDate}\n` +
          `    source: etl_auto, tier: standard\n`,
      );
    }
    if (recs.length > 5) {
      process.stdout.write(`  ... 외 ${recs.length - 5}건\n`);
    }

    process.stdout.write(
      "\n[DRY-RUN 완료] 위 내용을 반영하려면 --dry-run=false 플래그로 재실행하세요.\n",
    );
    await pool.end();
    return;
  }

  // 실행 모드: 이관
  process.stdout.write("--- 이관 시작 ---\n");
  const { insertedCount, skippedCount } = await runMigration(recs);

  // 이관 후 건수 검증
  const afterCount = await fetchEtlAutoCount();
  const actualNew = afterCount - beforeCount;

  process.stdout.write(`\n=== 이관 완료 ===\n`);
  process.stdout.write(`  INSERT 성공:      ${insertedCount}건\n`);
  process.stdout.write(`  SKIP (중복):      ${skippedCount}건\n`);
  process.stdout.write(`\n[이관 후] tracked_stocks (source=etl_auto): ${afterCount}건\n`);
  process.stdout.write(`  증가량: ${actualNew}건\n`);

  if (insertedCount !== actualNew) {
    process.stderr.write(
      `\n[경고] 건수 불일치: 카운터 기준=${insertedCount}, DB 실측=${actualNew}\n`,
    );
  } else {
    process.stdout.write(`\n[검증 통과] 이관 건수 일치 확인\n`);
  }

  await pool.end();
}

main().catch((e) => {
  process.stderr.write(`오류: ${String(e)}\n`);
  process.exit(1);
});
