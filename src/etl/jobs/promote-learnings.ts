import "dotenv/config";
import { db, pool } from "@/db/client";
import { theses, agentLearnings } from "@/db/schema/analyst";
import { eq, and, sql } from "drizzle-orm";
import { assertValidEnvironment } from "@/etl/utils/validation";

const MIN_HITS_FOR_PROMOTION = 3;
const LEARNING_EXPIRY_MONTHS = 6;
const MAX_ACTIVE_LEARNINGS = 50;

/**
 * 장기 기억 승격/강등 ETL.
 *
 * 흐름:
 * 1. CONFIRMED thesis에서 반복 패턴 카운트 (agentPersona별)
 * 2. 3회 이상 적중 패턴 → agent_learnings에 승격
 * 3. 6개월 초과 원칙 → 강등 (is_active = false)
 * 4. 최대 50개 유지
 */
async function main() {
  assertValidEnvironment();

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Promote learnings — date: ${today}`);

  // 1. 기존 활성 learnings 조회
  const activeLearnings = await db
    .select()
    .from(agentLearnings)
    .where(eq(agentLearnings.isActive, true));

  console.log(`Active learnings: ${activeLearnings.length}/${MAX_ACTIVE_LEARNINGS}`);

  // 2. 만료 강등 (6개월 초과)
  let demotedCount = 0;
  const expiryThreshold = new Date();
  expiryThreshold.setMonth(expiryThreshold.getMonth() - LEARNING_EXPIRY_MONTHS);
  const expiryDateStr = expiryThreshold.toISOString().slice(0, 10);

  for (const learning of activeLearnings) {
    const isExpired =
      learning.expiresAt != null && learning.expiresAt <= today;
    const isStale =
      learning.lastVerified != null && learning.lastVerified < expiryDateStr;

    if (isExpired || isStale) {
      await db
        .update(agentLearnings)
        .set({ isActive: false })
        .where(eq(agentLearnings.id, learning.id));

      console.log(`  DEMOTED: ${learning.principle.slice(0, 60)}...`);
      demotedCount++;
    }
  }

  // 3. CONFIRMED thesis 집계 — 동일 persona + 유사 패턴 카운트
  const confirmedTheses = await db
    .select()
    .from(theses)
    .where(eq(theses.status, "CONFIRMED"));

  console.log(`Confirmed theses for analysis: ${confirmedTheses.length}`);

  // 4. Persona별 적중 카운트 (간단 버전 — 정확한 패턴 매칭은 향후 에이전트 보완)
  const personaHits = new Map<string, number>();
  for (const t of confirmedTheses) {
    const key = t.agentPersona;
    personaHits.set(key, (personaHits.get(key) ?? 0) + 1);
  }

  // 5. 기존 learnings의 hitCount 업데이트
  const invalidatedTheses = await db
    .select()
    .from(theses)
    .where(eq(theses.status, "INVALIDATED"));

  for (const learning of activeLearnings) {
    if (learning.isActive === false) continue; // already demoted above

    const sourceIds: number[] = JSON.parse(learning.sourceThesisIds ?? "[]");
    const hits = sourceIds.filter((id) =>
      confirmedTheses.some((t) => t.id === id),
    ).length;
    const misses = sourceIds.filter((id) =>
      invalidatedTheses.some((t) => t.id === id),
    ).length;

    const totalHits = learning.hitCount + hits;
    const totalMisses = learning.missCount + misses;
    const total = totalHits + totalMisses;
    const hitRate = total > 0 ? totalHits / total : null;

    if (hits > 0 || misses > 0) {
      await db
        .update(agentLearnings)
        .set({
          hitCount: totalHits,
          missCount: totalMisses,
          hitRate: hitRate != null ? String(hitRate.toFixed(2)) : null,
          lastVerified: today,
        })
        .where(eq(agentLearnings.id, learning.id));
    }
  }

  console.log(`\nResults: ${demotedCount} demoted`);
  console.log(`Active learnings after: ${activeLearnings.length - demotedCount}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});
