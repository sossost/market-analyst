import "dotenv/config";
import { db, pool } from "@/db/client";
import { theses, agentLearnings } from "@/db/schema/analyst";
import { eq, sql } from "drizzle-orm";
import { assertValidEnvironment } from "@/etl/utils/validation";

const MIN_HITS_FOR_PROMOTION = 10;
const MIN_HIT_RATE = 0.70;
const MIN_TOTAL_OBSERVATIONS = 10;
const LEARNING_EXPIRY_MONTHS = 6;
const MAX_ACTIVE_LEARNINGS = 50;

interface PromotionCandidate {
  persona: string;
  metric: string;
  confirmedIds: number[];
  invalidatedIds: number[];
  hitCount: number;
  missCount: number;
}

/**
 * 장기 기억 승격/강등 ETL.
 *
 * 흐름:
 * 1. 만료 강등 (6개월 초과 or expiresAt 지남)
 * 2. 기존 learnings의 hitCount/missCount 업데이트
 * 3. CONFIRMED thesis에서 반복 패턴 → 신규 learning 승격
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
  const demotedCount = await demoteExpiredLearnings(activeLearnings, today);

  // 3. thesis 데이터 로드
  const [confirmedTheses, invalidatedTheses] = await Promise.all([
    db.select().from(theses).where(eq(theses.status, "CONFIRMED")),
    db.select().from(theses).where(eq(theses.status, "INVALIDATED")),
  ]);

  console.log(`Confirmed: ${confirmedTheses.length}, Invalidated: ${invalidatedTheses.length}`);

  // 4. 기존 learnings의 hitCount/missCount 업데이트
  const updatedCount = await updateLearningStats(
    activeLearnings.filter((l) => l.isActive !== false),
    confirmedTheses,
    invalidatedTheses,
    today,
  );

  // 5. 신규 learning 승격 (반복 적중 패턴)
  const existingSourceIds = new Set(
    activeLearnings.flatMap((l) => {
      try { return JSON.parse(l.sourceThesisIds ?? "[]") as number[]; }
      catch { return []; }
    }),
  );

  const candidates = buildPromotionCandidates(
    confirmedTheses,
    invalidatedTheses,
    existingSourceIds,
  );

  const activeCount = activeLearnings.length - demotedCount;
  const promotedCount = await promoteNewLearnings(candidates, activeCount, today);

  console.log(`\nResults: ${demotedCount} demoted, ${updatedCount} updated, ${promotedCount} promoted`);
  console.log(`Active learnings: ${activeCount + promotedCount}`);

  await pool.end();
}

async function demoteExpiredLearnings(
  learnings: typeof agentLearnings.$inferSelect[],
  today: string,
): Promise<number> {
  const expiryThreshold = new Date(today);
  expiryThreshold.setMonth(expiryThreshold.getMonth() - LEARNING_EXPIRY_MONTHS);
  const expiryDateStr = expiryThreshold.toISOString().slice(0, 10);

  let count = 0;
  for (const learning of learnings) {
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
      count++;
    }
  }
  return count;
}

/**
 * sourceThesisIds 기준으로 hitCount/missCount를 절대값으로 재계산.
 * 누적이 아닌 재계산 방식으로 중복 카운트 버그 방지.
 */
async function updateLearningStats(
  learnings: typeof agentLearnings.$inferSelect[],
  confirmedTheses: typeof theses.$inferSelect[],
  invalidatedTheses: typeof theses.$inferSelect[],
  today: string,
): Promise<number> {
  const confirmedIds = new Set(confirmedTheses.map((t) => t.id));
  const invalidatedIds = new Set(invalidatedTheses.map((t) => t.id));
  let count = 0;

  for (const learning of learnings) {
    const sourceIds: number[] = JSON.parse(learning.sourceThesisIds ?? "[]");
    const hits = sourceIds.filter((id) => confirmedIds.has(id)).length;
    const misses = sourceIds.filter((id) => invalidatedIds.has(id)).length;

    // 변화 없으면 스킵
    if (hits === learning.hitCount && misses === learning.missCount) continue;

    const total = hits + misses;
    const hitRate = total > 0 ? hits / total : null;

    await db
      .update(agentLearnings)
      .set({
        hitCount: hits,
        missCount: misses,
        hitRate: hitRate != null ? String(hitRate.toFixed(2)) : null,
        lastVerified: today,
      })
      .where(eq(agentLearnings.id, learning.id));

    count++;
  }
  return count;
}

/**
 * 검증된 thesis에서 persona + verificationMetric 기준으로
 * 반복 패턴을 그룹화하여 승격 후보 생성.
 */
export function buildPromotionCandidates(
  confirmedTheses: typeof theses.$inferSelect[],
  invalidatedTheses: typeof theses.$inferSelect[],
  existingSourceIds: Set<number>,
): PromotionCandidate[] {
  // persona + metric 기준 그룹화 (기존 learning에 없는 thesis만)
  const groups = new Map<string, { confirmed: typeof theses.$inferSelect[]; invalidated: typeof theses.$inferSelect[] }>();

  for (const t of confirmedTheses) {
    if (existingSourceIds.has(t.id)) continue;
    const key = `${t.agentPersona}::${t.verificationMetric}`;
    const group = groups.get(key) ?? { confirmed: [], invalidated: [] };
    group.confirmed.push(t);
    groups.set(key, group);
  }

  for (const t of invalidatedTheses) {
    if (existingSourceIds.has(t.id)) continue;
    const key = `${t.agentPersona}::${t.verificationMetric}`;
    const group = groups.get(key);
    if (group != null) {
      group.invalidated.push(t);
    }
  }

  return Array.from(groups.entries())
    .filter(([, g]) => {
      const total = g.confirmed.length + g.invalidated.length;
      const hitRate = total > 0 ? g.confirmed.length / total : 0;
      return (
        g.confirmed.length >= MIN_HITS_FOR_PROMOTION &&
        hitRate >= MIN_HIT_RATE &&
        total >= MIN_TOTAL_OBSERVATIONS
      );
    })
    .map(([key, g]) => {
      const [persona, metric] = key.split("::");

      return {
        persona,
        metric,
        confirmedIds: g.confirmed.map((t) => t.id),
        invalidatedIds: g.invalidated.map((t) => t.id),
        hitCount: g.confirmed.length,
        missCount: g.invalidated.length,
      };
    });
}

async function promoteNewLearnings(
  candidates: PromotionCandidate[],
  currentActiveCount: number,
  today: string,
): Promise<number> {
  const slotsAvailable = MAX_ACTIVE_LEARNINGS - currentActiveCount;
  if (slotsAvailable <= 0 || candidates.length === 0) return 0;

  // 적중률 높은 순으로 정렬
  const sorted = [...candidates].sort((a, b) => {
    const rateA = a.hitCount / (a.hitCount + a.missCount);
    const rateB = b.hitCount / (b.hitCount + b.missCount);
    return rateB - rateA;
  });

  const toPromote = sorted.slice(0, slotsAvailable);
  let count = 0;

  const expiresAt = new Date(today);
  expiresAt.setMonth(expiresAt.getMonth() + LEARNING_EXPIRY_MONTHS);
  const expiresAtStr = expiresAt.toISOString().slice(0, 10);

  for (const candidate of toPromote) {
    const total = candidate.hitCount + candidate.missCount;
    const hitRate = candidate.hitCount / total;
    const allIds = [...candidate.confirmedIds, ...candidate.invalidatedIds];

    const sanitizedMetric = candidate.metric.replace(/[\n\r]/g, " ").slice(0, 100);
    const principle = `[${candidate.persona}] ${sanitizedMetric} 관련 전망이 ${candidate.hitCount}회 적중 (적중률 ${(hitRate * 100).toFixed(0)}%, ${total}회 관측)`;
    const category = "confirmed";

    await db.insert(agentLearnings).values({
      principle,
      category,
      hitCount: candidate.hitCount,
      missCount: candidate.missCount,
      hitRate: String(hitRate.toFixed(2)),
      sourceThesisIds: JSON.stringify(allIds),
      firstConfirmed: today,
      lastVerified: today,
      expiresAt: expiresAtStr,
      isActive: true,
    });

    console.log(`  PROMOTED: ${principle}`);
    count++;
  }

  return count;
}

main().catch(async (err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});
