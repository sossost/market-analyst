import "dotenv/config";
import { db, pool } from "@/db/client";
import { sectorPhaseEvents, sectorLagPatterns } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import {
  calculateLagObservations,
  calculateLagStats,
} from "@/lib/sectorLagStats";
import { eq, and, sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────

interface EventsByEntity {
  entityName: string;
  dates: string[];
}

type EntityType = "sector" | "industry";
type Transition = "1to2" | "3to4";

// ── Phase 전이 → transition 매핑 ─────────────────────────────

const TRANSITION_MAP: Array<{
  fromPhase: number;
  toPhase: number;
  transition: Transition;
}> = [
  { fromPhase: 1, toPhase: 2, transition: "1to2" },
  { fromPhase: 3, toPhase: 4, transition: "3to4" },
];

// ── Core Logic ──────────────────────────────────────────────────

/**
 * 특정 entity_type + transition 조합에 대해 모든 엔티티별 이벤트 날짜를 조회한다.
 */
async function loadEventsByEntity(
  entityType: EntityType,
  fromPhase: number,
  toPhase: number,
): Promise<EventsByEntity[]> {
  const events = await retryDatabaseOperation(() =>
    db
      .select({
        entityName: sectorPhaseEvents.entityName,
        date: sectorPhaseEvents.date,
      })
      .from(sectorPhaseEvents)
      .where(
        and(
          eq(sectorPhaseEvents.entityType, entityType),
          eq(sectorPhaseEvents.fromPhase, fromPhase),
          eq(sectorPhaseEvents.toPhase, toPhase),
        ),
      ),
  );

  // 엔티티별로 날짜를 그룹핑
  const grouped = new Map<string, string[]>();
  for (const event of events) {
    const existing = grouped.get(event.entityName) ?? [];
    existing.push(event.date);
    grouped.set(event.entityName, existing);
  }

  return Array.from(grouped.entries()).map(([entityName, dates]) => ({
    entityName,
    dates: dates.sort(),
  }));
}

/**
 * 섹터/산업 쌍별 시차 통계를 계산하고 sector_lag_patterns에 UPSERT한다.
 */
async function computeAndUpsertPatterns(
  entityType: EntityType,
  transition: Transition,
  fromPhase: number,
  toPhase: number,
): Promise<number> {
  const entitiesByName = await loadEventsByEntity(entityType, fromPhase, toPhase);

  if (entitiesByName.length < 2) {
    console.log(
      `  ${entityType}/${transition}: fewer than 2 entities with events. Skipping.`,
    );
    return 0;
  }

  const today = new Date().toISOString().slice(0, 10);
  let upsertedCount = 0;

  for (const leader of entitiesByName) {
    for (const follower of entitiesByName) {
      // 자기 자신과의 시차는 의미 없음
      if (leader.entityName === follower.entityName) continue;

      const observations = calculateLagObservations(
        leader.dates,
        follower.dates,
      );

      if (observations.length === 0) continue;

      const lagDays = observations.map((o) => o.lagDays);
      const stats = calculateLagStats(lagDays);

      if (stats == null) continue;

      // 최근 관측 정보
      const lastObs = observations[observations.length - 1];

      await retryDatabaseOperation(() =>
        db
          .insert(sectorLagPatterns)
          .values({
            entityType,
            leaderEntity: leader.entityName,
            followerEntity: follower.entityName,
            transition,
            sampleCount: stats.sampleCount,
            avgLagDays: String(stats.avgLagDays),
            medianLagDays: String(stats.medianLagDays),
            stddevLagDays: String(stats.stddevLagDays),
            minLagDays: stats.minLagDays,
            maxLagDays: stats.maxLagDays,
            isReliable: stats.isReliable,
            lastObservedAt: lastObs.followerDate,
            lastLagDays: lastObs.lagDays,
            lastUpdated: today,
          })
          .onConflictDoUpdate({
            target: [
              sectorLagPatterns.entityType,
              sectorLagPatterns.leaderEntity,
              sectorLagPatterns.followerEntity,
              sectorLagPatterns.transition,
            ],
            set: {
              sampleCount: sql`excluded.sample_count`,
              avgLagDays: sql`excluded.avg_lag_days`,
              medianLagDays: sql`excluded.median_lag_days`,
              stddevLagDays: sql`excluded.stddev_lag_days`,
              minLagDays: sql`excluded.min_lag_days`,
              maxLagDays: sql`excluded.max_lag_days`,
              isReliable: sql`excluded.is_reliable`,
              lastObservedAt: sql`excluded.last_observed_at`,
              lastLagDays: sql`excluded.last_lag_days`,
              lastUpdated: sql`excluded.last_updated`,
            },
          }),
      );

      upsertedCount++;
    }
  }

  return upsertedCount;
}

// ── Main ──────────────────────────────────────────────────────

/**
 * sector_phase_events 데이터를 기반으로 섹터/산업 쌍별 시차 통계를 재계산하여
 * sector_lag_patterns에 UPSERT한다.
 */
export async function updateSectorLagPatterns(): Promise<{
  totalUpserted: number;
}> {
  let totalUpserted = 0;

  for (const entityType of ["sector", "industry"] as const) {
    for (const { fromPhase, toPhase, transition } of TRANSITION_MAP) {
      console.log(`Computing ${entityType}/${transition} patterns...`);

      const count = await computeAndUpsertPatterns(
        entityType,
        transition,
        fromPhase,
        toPhase,
      );

      console.log(`  → ${count} patterns upserted`);
      totalUpserted += count;
    }
  }

  return { totalUpserted };
}

// ── CLI Entrypoint ──────────────────────────────────────────────

async function main() {
  assertValidEnvironment();
  console.log("update-sector-lag-patterns — starting...");

  const result = await updateSectorLagPatterns();
  console.log(`Done. Total patterns upserted: ${result.totalUpserted}`);

  await pool.end();
}

main().catch((err) => {
  console.error("update-sector-lag-patterns failed:", err);
  pool.end();
  process.exit(1);
});
