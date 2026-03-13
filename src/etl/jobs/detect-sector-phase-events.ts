import "dotenv/config";
import { db, pool } from "@/db/client";
import { sectorPhaseEvents } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { logger } from "@/agent/logger";

const TAG = "DETECT_SECTOR_PHASE_EVENTS";

// ── Types ──────────────────────────────────────────────────────

interface RawPhaseTransition {
  date: string;
  entity_name: string;
  from_phase: number;
  to_phase: number;
  avg_rs: string | null;
  phase2_ratio: string | null;
}

export interface PhaseEvent {
  date: string;
  entityType: "sector" | "industry";
  entityName: string;
  fromPhase: number;
  toPhase: number;
  avgRs: string | null;
  phase2Ratio: string | null;
}

// ── Core Logic (testable) ──────────────────────────────────────

/**
 * 원시 행에서 유효한 Phase 전이 이벤트만 필터링한다.
 * - prevGroupPhase가 null이면 이벤트 미생성
 * - from_phase === to_phase이면 이벤트 미생성
 */
export function filterValidTransitions(
  rows: RawPhaseTransition[],
  entityType: "sector" | "industry",
): PhaseEvent[] {
  return rows
    .filter((r) => r.from_phase !== r.to_phase)
    .map((r) => ({
      date: r.date,
      entityType,
      entityName: r.entity_name,
      fromPhase: r.from_phase,
      toPhase: r.to_phase,
      avgRs: r.avg_rs,
      phase2Ratio: r.phase2_ratio,
    }));
}

// ── DB Operations ──────────────────────────────────────────────

/**
 * sector_rs_daily에서 Phase 전이 이벤트를 탐지한다.
 */
async function querySectorTransitions(
  mode: "backfill" | "incremental",
  targetDate?: string,
): Promise<RawPhaseTransition[]> {
  const baseQuery = `SELECT date, sector AS entity_name,
              prev_group_phase AS from_phase, group_phase AS to_phase,
              avg_rs::text, phase2_ratio::text
       FROM sector_rs_daily
       WHERE prev_group_phase IS NOT NULL
         AND group_phase != prev_group_phase`;

  if (mode === "incremental" && targetDate != null) {
    const { rows } = await retryDatabaseOperation(() =>
      pool.query<RawPhaseTransition>(`${baseQuery} AND date = $1 ORDER BY date`, [targetDate]),
    );
    return rows;
  }

  const { rows } = await retryDatabaseOperation(() =>
    pool.query<RawPhaseTransition>(`${baseQuery} ORDER BY date`),
  );
  return rows;
}

/**
 * industry_rs_daily에서 Phase 전이 이벤트를 탐지한다.
 */
async function queryIndustryTransitions(
  mode: "backfill" | "incremental",
  targetDate?: string,
): Promise<RawPhaseTransition[]> {
  const baseQuery = `SELECT date, industry AS entity_name,
              prev_group_phase AS from_phase, group_phase AS to_phase,
              avg_rs::text, phase2_ratio::text
       FROM industry_rs_daily
       WHERE prev_group_phase IS NOT NULL
         AND group_phase != prev_group_phase`;

  if (mode === "incremental" && targetDate != null) {
    const { rows } = await retryDatabaseOperation(() =>
      pool.query<RawPhaseTransition>(`${baseQuery} AND date = $1 ORDER BY date`, [targetDate]),
    );
    return rows;
  }

  const { rows } = await retryDatabaseOperation(() =>
    pool.query<RawPhaseTransition>(`${baseQuery} ORDER BY date`),
  );
  return rows;
}

/**
 * Phase 전이 이벤트를 sector_phase_events에 UPSERT한다.
 * 중복 삽입 방지: (date, entity_type, entity_name, from_phase, to_phase) UNIQUE 제약.
 */
async function upsertPhaseEvents(events: PhaseEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  // Batch in chunks of 500
  const BATCH_SIZE = 500;
  let insertedCount = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);

    await retryDatabaseOperation(() =>
      db
        .insert(sectorPhaseEvents)
        .values(
          batch.map((e) => ({
            date: e.date,
            entityType: e.entityType,
            entityName: e.entityName,
            fromPhase: e.fromPhase,
            toPhase: e.toPhase,
            avgRs: e.avgRs,
            phase2Ratio: e.phase2Ratio,
          })),
        )
        .onConflictDoNothing({
          target: [
            sectorPhaseEvents.date,
            sectorPhaseEvents.entityType,
            sectorPhaseEvents.entityName,
            sectorPhaseEvents.fromPhase,
            sectorPhaseEvents.toPhase,
          ],
        }),
    );

    insertedCount += batch.length;
  }

  return insertedCount; // processed count (duplicates skipped via onConflictDoNothing)
}

// ── Main ──────────────────────────────────────────────────────

/**
 * 섹터/산업 Phase 전이 이벤트를 탐지하여 sector_phase_events에 기록한다.
 *
 * mode: 'backfill' — 전체 기간 소급 (최초 1회)
 * mode: 'incremental' — 최신 날짜만 처리 (매일)
 */
export async function detectSectorPhaseEvents(
  mode: "backfill" | "incremental",
  targetDate?: string,
): Promise<{ sectorEvents: number; industryEvents: number }> {
  // 1. 섹터 전이 탐지
  const sectorRows = await querySectorTransitions(mode, targetDate);
  const sectorEvents = filterValidTransitions(sectorRows, "sector");
  const sectorInserted = await upsertPhaseEvents(sectorEvents);
  logger.info(
    TAG,
    `Sector phase events: ${sectorRows.length} transitions detected, ${sectorInserted} processed (duplicates skipped)`,
  );

  // 2. 산업 전이 탐지
  const industryRows = await queryIndustryTransitions(mode, targetDate);
  const industryEvents = filterValidTransitions(industryRows, "industry");
  const industryInserted = await upsertPhaseEvents(industryEvents);
  logger.info(
    TAG,
    `Industry phase events: ${industryRows.length} transitions detected, ${industryInserted} processed (duplicates skipped)`,
  );

  return {
    sectorEvents: sectorInserted,
    industryEvents: industryInserted,
  };
}

// ── CLI Entrypoint ──────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  const isBackfill = process.argv.includes("--backfill");
  const mode = isBackfill ? "backfill" : "incremental";

  logger.info(TAG, `detect-sector-phase-events — mode: ${mode}`);

  let targetDate: string | undefined;
  if (mode === "incremental") {
    const latestDate = await getLatestTradeDate();
    if (latestDate == null) {
      logger.info(TAG, "No trade date found. Skipping.");
      await pool.end();
      return;
    }
    targetDate = latestDate;
    logger.info(TAG, `Target date: ${targetDate}`);
  }

  const result = await detectSectorPhaseEvents(mode, targetDate);
  logger.info(
    TAG,
    `Done. Sector: ${result.sectorEvents}, Industry: ${result.industryEvents}`,
  );

  await pool.end();
}

main().catch((err) => {
  logger.error(TAG, `detect-sector-phase-events failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
