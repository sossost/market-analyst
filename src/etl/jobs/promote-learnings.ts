import "dotenv/config";
import { db, pool } from "@/db/client";
import { theses, agentLearnings, failurePatterns } from "@/db/schema/analyst";
import { eq, sql, and } from "drizzle-orm";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { binomialTest } from "@/lib/statisticalTests";
import { detectBullBias } from "@/lib/biasDetector";
import { logger } from "@/agent/logger";

const TAG = "PROMOTE_LEARNINGS";

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
  verificationMethods: string[];
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
  logger.info(TAG, `Promote learnings — date: ${today}`);

  // 1. 기존 활성 learnings 조회
  const activeLearnings = await db
    .select()
    .from(agentLearnings)
    .where(eq(agentLearnings.isActive, true));

  logger.info(TAG, `Active learnings: ${activeLearnings.length}/${MAX_ACTIVE_LEARNINGS}`);

  // 2. 만료 강등 (6개월 초과)
  const demotedCount = await demoteExpiredLearnings(activeLearnings, today);

  // 3. thesis 데이터 로드
  const [confirmedTheses, invalidatedTheses] = await Promise.all([
    db.select().from(theses).where(eq(theses.status, "CONFIRMED")),
    db.select().from(theses).where(eq(theses.status, "INVALIDATED")),
  ]);

  logger.info(TAG, `Confirmed: ${confirmedTheses.length}, Invalidated: ${invalidatedTheses.length}`);

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

  // 6. 실패 패턴 기반 경계 학습 승격/강등
  const cautionPromoted = await promoteFailurePatterns(today);

  // 편향 체크 (최신 상태 재조회)
  const latestLearnings = await db
    .select()
    .from(agentLearnings)
    .where(eq(agentLearnings.isActive, true));
  const activePrinciples = latestLearnings.map((l) => l.principle);
  const bias = detectBullBias(activePrinciples);
  logger.info(TAG, `Bull-bias: ${(bias.bullRatio * 100).toFixed(0)}% (${bias.bullCount}B/${bias.bearCount}b of ${bias.totalLearnings})`);
  if (bias.isSkewed) {
    logger.warn(TAG, `BIAS WARNING: Bull-bias ${(bias.bullRatio * 100).toFixed(0)}% > 80% 임계값`);
  }

  logger.info(TAG, `Results: ${demotedCount} demoted, ${updatedCount} updated, ${promotedCount} promoted, ${cautionPromoted} caution`);
  logger.info(TAG, `Active learnings: ${latestLearnings.length}`);

  await pool.end();
}

const CONCURRENCY_LIMIT = 5;

async function demoteExpiredLearnings(
  learnings: typeof agentLearnings.$inferSelect[],
  today: string,
): Promise<number> {
  const expiryThreshold = new Date(today);
  expiryThreshold.setMonth(expiryThreshold.getMonth() - LEARNING_EXPIRY_MONTHS);
  const expiryDateStr = expiryThreshold.toISOString().slice(0, 10);

  // caution 카테고리는 promoteFailurePatterns에서 별도 강등 경로가 있으므로
  // 6개월 만료 규칙 적용 대상에서 제외한다.
  const toDemote = learnings.filter((learning) => {
    if (learning.category === "caution") return false;

    const isExpired =
      learning.expiresAt != null && learning.expiresAt <= today;
    const isStale =
      learning.lastVerified != null && learning.lastVerified < expiryDateStr;

    return isExpired || isStale;
  });

  for (let i = 0; i < toDemote.length; i += CONCURRENCY_LIMIT) {
    const batch = toDemote.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async (learning) => {
        await db
          .update(agentLearnings)
          .set({ isActive: false })
          .where(eq(agentLearnings.id, learning.id));
        logger.info(TAG, `  DEMOTED: ${learning.principle.slice(0, 60)}...`);
      }),
    );
  }

  return toDemote.length;
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

  // 업데이트 대상만 먼저 필터
  const toUpdate: Array<{ id: number; hits: number; misses: number }> = [];

  for (const learning of learnings) {
    // caution 카테고리는 failure_patterns에서 별도 관리
    if (learning.category === "caution") continue;

    let sourceIds: number[];
    try {
      sourceIds = JSON.parse(learning.sourceThesisIds ?? "[]") as number[];
    } catch {
      sourceIds = [];
    }
    const hits = sourceIds.filter((id) => confirmedIds.has(id)).length;
    const misses = sourceIds.filter((id) => invalidatedIds.has(id)).length;

    // 변화 없으면 스킵
    if (hits === learning.hitCount && misses === learning.missCount) continue;

    toUpdate.push({ id: learning.id, hits, misses });
  }

  for (let i = 0; i < toUpdate.length; i += CONCURRENCY_LIMIT) {
    const batch = toUpdate.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async ({ id, hits, misses }) => {
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
          .where(eq(agentLearnings.id, id));
      }),
    );
  }

  return toUpdate.length;
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

      // 기존 기준: 최소 적중 수 + 적중률 + 최소 관측 수
      if (g.confirmed.length < MIN_HITS_FOR_PROMOTION) return false;
      if (hitRate < MIN_HIT_RATE) return false;
      if (total < MIN_TOTAL_OBSERVATIONS) return false;

      // 통계적 유의성 검증 (자기확증편향 방지)
      const test = binomialTest(g.confirmed.length, total);
      if (!test.isSignificant) {
        logger.info(TAG, `  SKIP (not significant): p=${test.pValue.toFixed(4)}, h=${test.cohenH.toFixed(2)}`);
        return false;
      }

      return true;
    })
    .map(([key, g]) => {
      const [persona, metric] = key.split("::");
      const allTheses = [...g.confirmed, ...g.invalidated];
      const verificationMethods = [
        ...new Set(
          allTheses
            .map((t) => t.verificationMethod)
            .filter((m): m is string => m != null),
        ),
      ];

      return {
        persona,
        metric,
        confirmedIds: g.confirmed.map((t) => t.id),
        invalidatedIds: g.invalidated.map((t) => t.id),
        hitCount: g.confirmed.length,
        missCount: g.invalidated.length,
        verificationMethods,
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

  const expiresAt = new Date(today);
  expiresAt.setMonth(expiresAt.getMonth() + LEARNING_EXPIRY_MONTHS);
  const expiresAtStr = expiresAt.toISOString().slice(0, 10);

  for (let i = 0; i < toPromote.length; i += CONCURRENCY_LIMIT) {
    const batch = toPromote.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async (candidate) => {
        const total = candidate.hitCount + candidate.missCount;
        const hitRate = candidate.hitCount / total;
        const allIds = [...candidate.confirmedIds, ...candidate.invalidatedIds];

        const sanitizedMetric = candidate.metric.replace(/[\n\r]/g, " ").slice(0, 100);
        const principle = `[${candidate.persona}] ${sanitizedMetric} 관련 전망이 ${candidate.hitCount}회 적중 (적중률 ${(hitRate * 100).toFixed(0)}%, ${total}회 관측)`;
        const category = "confirmed";

        const methods = new Set(candidate.verificationMethods);
        const verificationPath =
          methods.size === 0
            ? null
            : methods.size === 1
              ? methods.has("quantitative")
                ? "quantitative"
                : "llm"
              : "mixed";

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
          verificationPath,
        });

        logger.info(TAG, `  PROMOTED: ${principle}`);
      }),
    );
  }

  return toPromote.length;
}

// ─── Failure Pattern → Caution Learning 승격/강등 ─────────────────

const FAILURE_PATTERN_SOURCE = "failure_pattern_promotion";

/**
 * 실패 패턴 조건 키를 읽기 쉬운 설명으로 변환.
 */
export function buildCautionPrinciple(
  patternName: string,
  failureRate: number,
  totalCount: number,
): string {
  return `[경계] ${patternName} 조건에서 Phase 2 신호 실패율 ${(failureRate * 100).toFixed(0)}% (${totalCount}회 관측)`;
}

/**
 * failure_patterns.isActive = true인 패턴을 agent_learnings(category='caution')로 승격.
 * 비활성화된 패턴에 연결된 caution learning은 강등(isActive=false).
 *
 * caution 카테고리에서 hitCount = 실패 횟수, missCount = 성공 횟수 (역방향).
 * hitRate = 실패율.
 */
export async function promoteFailurePatterns(today: string): Promise<number> {
  // 1. 활성 failure_patterns 로드
  const activePatterns = await db
    .select()
    .from(failurePatterns)
    .where(eq(failurePatterns.isActive, true));

  // 2. 기존 caution learnings 로드
  const cautionLearnings = await db
    .select()
    .from(agentLearnings)
    .where(
      and(
        eq(agentLearnings.category, "caution"),
        eq(agentLearnings.isActive, true),
      ),
    );

  // 기존 caution principle → learning 매핑
  // NOTE: caution 카테고리에서 sourceThesisIds 컬럼은 thesis ID가 아닌
  // failure_pattern 소스 식별자(JSON: { source, pattern })를 저장한다.
  // 스키마 변경 없이 컬럼을 재활용하는 구조이므로, 아래에서 cautionSourceKey로 별칭한다.
  const existingCautionBySource = new Map<string, typeof agentLearnings.$inferSelect>();
  for (const learning of cautionLearnings) {
    const cautionSourceKey = learning.sourceThesisIds;
    if (cautionSourceKey != null) {
      existingCautionBySource.set(cautionSourceKey, learning);
    }
  }

  let promotedCount = 0;

  // 3. 활성 패턴 → caution learning 신규 삽입/업데이트 (병렬)
  const activePatternNames = new Set<string>();

  // activePatternNames를 먼저 구축 (이후 강등 판정에 사용)
  for (const pattern of activePatterns) {
    activePatternNames.add(pattern.patternName);
  }

  for (let i = 0; i < activePatterns.length; i += CONCURRENCY_LIMIT) {
    const batch = activePatterns.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.all(
      batch.map(async (pattern) => {
        const failureRate = pattern.failureRate != null ? Number(pattern.failureRate) : 0;
        const principle = buildCautionPrinciple(
          pattern.patternName,
          failureRate,
          pattern.totalCount,
        );

        // NOTE: caution 카테고리에서 sourceThesisIds는 thesis ID가 아닌
        // failure_pattern 소스 식별자(cautionSourceKey)를 저장한다.
        const cautionSourceKey = JSON.stringify({ source: FAILURE_PATTERN_SOURCE, pattern: pattern.patternName });

        const existingCaution = existingCautionBySource.get(cautionSourceKey);
        if (existingCaution != null) {
          await db
            .update(agentLearnings)
            .set({
              principle,
              hitCount: pattern.failureCount,
              missCount: pattern.totalCount - pattern.failureCount,
              hitRate: pattern.failureRate,
              lastVerified: today,
            })
            .where(eq(agentLearnings.id, existingCaution.id));
          return false; // 업데이트만, 신규 아님
        }

        await db.insert(agentLearnings).values({
          principle,
          category: "caution",
          hitCount: pattern.failureCount,
          missCount: pattern.totalCount - pattern.failureCount,
          hitRate: pattern.failureRate,
          sourceThesisIds: cautionSourceKey,
          firstConfirmed: today,
          lastVerified: today,
          isActive: true,
          verificationPath: "quantitative",
        });

        logger.info(TAG, `  CAUTION PROMOTED: ${principle}`);
        return true; // 신규 삽입
      }),
    );

    promotedCount += results.filter(Boolean).length;
  }

  // 4. 비활성화된 패턴에 연결된 caution learning 강등 (병렬)
  const toDemoteCaution = Array.from(existingCautionBySource.entries()).filter(
    ([sourceKey]) => {
      try {
        const parsed = JSON.parse(sourceKey) as { source: string; pattern: string };
        return (
          parsed.source === FAILURE_PATTERN_SOURCE &&
          !activePatternNames.has(parsed.pattern)
        );
      } catch {
        return false;
      }
    },
  );

  for (let i = 0; i < toDemoteCaution.length; i += CONCURRENCY_LIMIT) {
    const batch = toDemoteCaution.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async ([, learning]) => {
        await db
          .update(agentLearnings)
          .set({ isActive: false })
          .where(eq(agentLearnings.id, learning.id));
        logger.info(TAG, `  CAUTION DEMOTED: ${learning.principle.slice(0, 60)}...`);
      }),
    );
  }

  return promotedCount;
}

main().catch(async (err) => {
  logger.error(TAG, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});
