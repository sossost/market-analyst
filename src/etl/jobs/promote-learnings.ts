import "dotenv/config";
import { db, pool } from "@/db/client";
import { theses, agentLearnings, failurePatterns } from "@/db/schema/analyst";
import { eq, sql, and, inArray } from "drizzle-orm";

export const BEAR_KEYWORDS_FOR_PRIORITY = ["하락", "약세", "부정", "조정", "위축", "둔화", "악화", "하향", "리스크", "경계"];
import { assertValidEnvironment } from "@/etl/utils/validation";
import { binomialTest } from "@/lib/statisticalTests";
import { detectBullBias } from "@/lib/biasDetector";
import { logger } from "@/lib/logger";

const TAG = "PROMOTE_LEARNINGS";

const LEARNING_EXPIRY_MONTHS = 6;
const MAX_ACTIVE_LEARNINGS = 50;

/**
 * 성숙도 게이트: 시스템이 bootstrap/cold start를 탈출한 후,
 * 관측 횟수가 이 값 미만인 confirmed 학습을 자동 강등한다.
 * 단일 우연을 일반 원칙으로 오인하는 것을 방지. (#394)
 */
export const MIN_MATURATION_HITS = 3;

export const BOOTSTRAP_THRESHOLD = 2;
export const COLD_START_THRESHOLD = 5;
export const GROWTH_PHASE_THRESHOLD = 15;

interface PromotionThresholds {
  minHits: number;
  minHitRate: number;
  minTotal: number;
  /** bootstrap 단계에서는 binomial test를 건너뛴다 */
  skipBinomialTest: boolean;
}

/** Bootstrap (0~1건): 단일 적중으로도 학습 루프 시동 허용. binomial test 면제. */
const BOOTSTRAP_THRESHOLDS: PromotionThresholds = { minHits: 1, minHitRate: 0.55, minTotal: 1, skipBinomialTest: true };
/**
 * Cold start (2~4건): 완화 기준 + binomial test 면제.
 * 소표본(2~4건)에서 p<0.05는 수학적으로 불가 → hitRate로 품질 제어. (#437)
 */
const COLD_START_THRESHOLDS: PromotionThresholds = { minHits: 2, minHitRate: 0.55, minTotal: 2, skipBinomialTest: true };
/** 성장기 (5~14건): 중간 기준 — binomial test 필수 */
const GROWTH_THRESHOLDS: PromotionThresholds = { minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false };
/** 정상 운영 (15건+): 엄격 기준 유지 */
const NORMAL_THRESHOLDS: PromotionThresholds = { minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false };

/**
 * 현재 활성 학습 건수에 따라 승격 기준을 동적으로 반환한다.
 *
 * 소표본에서 binomial test(p<0.05)는 수학적으로 통과 불가(5건에서 5/5 필요).
 * 첫 학습 진입이 불가능하면 전체 학습 루프가 영구 비활성 상태에 빠진다.
 */
export function getPromotionThresholds(activeLearningCount: number): PromotionThresholds {
  if (activeLearningCount < BOOTSTRAP_THRESHOLD) {
    return BOOTSTRAP_THRESHOLDS;
  }
  if (activeLearningCount < COLD_START_THRESHOLD) {
    return COLD_START_THRESHOLDS;
  }
  if (activeLearningCount < GROWTH_PHASE_THRESHOLD) {
    return GROWTH_THRESHOLDS;
  }
  return NORMAL_THRESHOLDS;
}

interface PromotionCandidate {
  persona: string;
  metric: string;
  confirmedIds: number[];
  invalidatedIds: number[];
  hitCount: number;
  missCount: number;
  verificationMethods: string[];
}

// ---------------------------------------------------------------------------
// verificationMetric 정규화
//
// LLM이 같은 지표를 다양한 형태로 생성하므로 (e.g. "Technology RS", "Tech RS",
// "Information Technology 섹터 RS") 학습 그룹핑 시 정규화가 필요하다.
// ---------------------------------------------------------------------------

const METRIC_ALIASES: Record<string, string> = {
  spx: "S&P 500", sp500: "S&P 500", "s&p500": "S&P 500", "s&p 500": "S&P 500",
  qqq: "NASDAQ", nasdaq: "NASDAQ",
  iwm: "Russell 2000", "russell 2000": "Russell 2000",
  "dow 30": "DOW 30", dow: "DOW 30", djia: "DOW 30",
  vix: "VIX",
  "fear & greed": "Fear & Greed", "fear and greed": "Fear & Greed", "공포탐욕지수": "Fear & Greed",
  // Commodities (#427)
  wti: "WTI Crude", "wti crude": "WTI Crude", "crude oil": "WTI Crude", "원유": "WTI Crude",
  "brent": "Brent Crude", "brent crude": "Brent Crude", "브렌트유": "Brent Crude",
  gold: "Gold", "금": "Gold", xau: "Gold",
  silver: "Silver", "은": "Silver",
  copper: "Copper", "구리": "Copper",
  // Rates
  "10y": "US 10Y Yield", "10년물": "US 10Y Yield", "us 10y": "US 10Y Yield", "us 10y yield": "US 10Y Yield",
  "2y": "US 2Y Yield", "2년물": "US 2Y Yield", "us 2y": "US 2Y Yield", "us 2y yield": "US 2Y Yield",
  dxy: "DXY", "달러인덱스": "DXY", "dollar index": "DXY",
};

const SECTOR_METRIC_ALIASES: Record<string, string> = {
  tech: "Technology", it: "Technology", "information technology": "Technology", "info tech": "Technology",
  "comm services": "Communication Services", communications: "Communication Services", telecom: "Communication Services",
  "consumer discretionary": "Consumer Cyclical", "cons cyclical": "Consumer Cyclical", discretionary: "Consumer Cyclical",
  "consumer staples": "Consumer Defensive", "cons defensive": "Consumer Defensive", staples: "Consumer Defensive",
  financials: "Financial Services", finance: "Financial Services", financial: "Financial Services",
  materials: "Basic Materials", "basic material": "Basic Materials",
  health: "Healthcare", "health care": "Healthcare",
  industrial: "Industrials",
  realestate: "Real Estate", reit: "Real Estate", reits: "Real Estate",
  utility: "Utilities",
};

const SECTOR_RS_NORMALIZE_PATTERN = /^(.+?)\s*(?:섹터\s+|sector\s+)?RS(?:\s+score)?$/i;

/**
 * verificationMetric 문자열을 정규화된 키로 변환.
 *
 * "Tech RS" → "Technology RS"
 * "Information Technology 섹터 RS" → "Technology RS"
 * "SPX" → "S&P 500"
 */
export function normalizeMetricKey(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // 섹터 RS 패턴 매칭
  const sectorMatch = SECTOR_RS_NORMALIZE_PATTERN.exec(trimmed);
  if (sectorMatch != null) {
    const rawSector = sectorMatch[1].trim().toLowerCase();
    const canonical = SECTOR_METRIC_ALIASES[rawSector] ?? sectorMatch[1].trim();
    return `${canonical} RS`;
  }

  // 지수/기타 지표 별칭
  const aliased = METRIC_ALIASES[lower];
  if (aliased != null) return aliased;

  return trimmed;
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
  const demotedIds = await demoteExpiredLearnings(activeLearnings, today);
  const demotedCount = demotedIds.length;

  // 강등된 항목을 in-memory 배열에서 제거 — 이후 단계에서 중복 처리 방지
  const demotedIdSet = new Set(demotedIds);
  const remainingLearnings = activeLearnings.filter((l) => !demotedIdSet.has(l.id));

  // 3. thesis 데이터 로드 (EXPIRED도 부정 신호로 포함)
  const [confirmedTheses, invalidatedTheses, expiredTheses] = await Promise.all([
    db.select().from(theses).where(eq(theses.status, "CONFIRMED")),
    db.select().from(theses).where(eq(theses.status, "INVALIDATED")),
    db.select().from(theses).where(eq(theses.status, "EXPIRED")),
  ]);

  logger.info(TAG, `Confirmed: ${confirmedTheses.length}, Invalidated: ${invalidatedTheses.length}, Expired: ${expiredTheses.length}`);

  // 4. 기존 learnings의 hitCount/missCount 업데이트
  const allNegativeTheses = [...invalidatedTheses, ...expiredTheses];
  const updatedCount = await updateLearningStats(
    remainingLearnings,
    confirmedTheses,
    allNegativeTheses,
    today,
  );

  // 4b. 새 thesis를 기존 학습에 흡수 (#427)
  // 기존 학습의 persona+metric 패턴과 일치하는 새 thesis를 sourceThesisIds에 추가.
  // 이를 통해 기존 학습의 hitCount가 자연 성장하여 성숙도 게이트를 통과할 수 있다.
  const allJudgedTheses = [...confirmedTheses, ...invalidatedTheses, ...expiredTheses];
  const absorbedCount = await absorbNewTheses(
    remainingLearnings,
    allJudgedTheses,
    today,
  );

  // 5. 신규 learning 승격 (반복 적중 패턴)
  // 흡수 후 in-memory learnings의 sourceThesisIds가 갱신되었으므로 재계산
  const existingSourceIds = new Set(
    remainingLearnings.flatMap((l) => {
      try { return JSON.parse(l.sourceThesisIds ?? "[]") as number[]; }
      catch { return []; }
    }),
  );

  let activeCountAfterDemotion = remainingLearnings.length;

  // 4a. 성숙도 게이트 — bootstrap 졸업 후 관측 부족 학습 강등 (#394)
  const maturationDemotedCount = await demoteImmatureLearnings(
    remainingLearnings,
    activeCountAfterDemotion,
  );
  if (maturationDemotedCount > 0) {
    logger.info(TAG, `Maturation gate: ${maturationDemotedCount} immature learnings demoted (hit_count < ${MIN_MATURATION_HITS})`);
    activeCountAfterDemotion -= maturationDemotedCount;
  }

  // 5a. 현재 편향 체크 (승격 전 상태 기준 — bear-priority 정렬에 사용)
  const prePrinciples = remainingLearnings.map((l) => l.principle);
  const preBias = detectBullBias(prePrinciples);
  if (preBias.isSkewed) {
    logger.warn(TAG, `BIAS WARNING (pre-promote): Bull-bias ${(preBias.bullRatio * 100).toFixed(0)}% > 80% — bear 후보 우선 승격`);
  }

  // Bootstrap/Cold start 단계에서는 EXPIRED thesis를 부정 신호에서 제외.
  // EXPIRED = "검증 시한 초과" (ambiguous) ≠ "예측 실패" (negative).
  // 학습 0~4건 상태에서 EXPIRED를 부정으로 계산하면 hitRate가 희석되어
  // bootstrap이 영구적으로 불가능해진다. (#360)
  const isEarlyPhase = activeCountAfterDemotion < COLD_START_THRESHOLD;
  const negativesForPromotion = isEarlyPhase ? invalidatedTheses : allNegativeTheses;

  if (isEarlyPhase && expiredTheses.length > 0) {
    logger.info(TAG, `Early phase (${activeCountAfterDemotion} learnings): EXPIRED ${expiredTheses.length}건을 부정 신호에서 제외`);
  }

  const candidates = buildPromotionCandidates(
    confirmedTheses,
    negativesForPromotion,
    existingSourceIds,
    activeCountAfterDemotion,
  );
  const promotedCount = await promoteNewLearnings(candidates, activeCountAfterDemotion, today, preBias.isSkewed);

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

  logger.info(TAG, `Results: ${demotedCount} expired-demoted, ${maturationDemotedCount} maturation-demoted, ${updatedCount} updated, ${absorbedCount} absorbed, ${promotedCount} promoted, ${cautionPromoted} caution`);
  logger.info(TAG, `Active learnings: ${latestLearnings.length}`);

  // 학습 루프 헬스체크 — 활성 학습 0건이면 경고
  const totalJudged = confirmedTheses.length + invalidatedTheses.length + expiredTheses.length;
  await checkLearningLoopHealth(latestLearnings.length, today, totalJudged);

  await pool.end();
}

const CONCURRENCY_LIMIT = 5;

async function demoteExpiredLearnings(
  learnings: typeof agentLearnings.$inferSelect[],
  today: string,
): Promise<number[]> {
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

  return toDemote.map((l) => l.id);
}

/**
 * 성숙도 게이트: bootstrap/cold start 이후에도 hit_count가 낮은 학습을 강등한다.
 *
 * Bootstrap 단계에서는 minHits=1로 학습 루프 시동을 허용하지만,
 * 시스템이 COLD_START_THRESHOLD 이상으로 성장한 뒤에는
 * MIN_MATURATION_HITS 미만의 학습을 자동 강등하여 통계적 신뢰성을 확보한다. (#394)
 */
export async function demoteImmatureLearnings(
  learnings: typeof agentLearnings.$inferSelect[],
  activeLearningCount: number,
): Promise<number> {
  if (activeLearningCount < COLD_START_THRESHOLD) {
    return 0;
  }

  const toDemote = learnings.filter((learning) => {
    if (learning.category !== "confirmed") return false;
    return learning.hitCount < MIN_MATURATION_HITS;
  });

  for (let i = 0; i < toDemote.length; i += CONCURRENCY_LIMIT) {
    const batch = toDemote.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async (learning) => {
        await db
          .update(agentLearnings)
          .set({ isActive: false })
          .where(eq(agentLearnings.id, learning.id));
        logger.info(TAG, `  MATURATION DEMOTED (hit_count=${learning.hitCount} < ${MIN_MATURATION_HITS}): ${learning.principle.slice(0, 60)}...`);
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
 * 기존 활성 학습의 persona+metric 패턴과 일치하는 새 thesis를
 * sourceThesisIds에 흡수한다. (#427)
 *
 * 학습이 생성된 이후에 판정된 thesis가 같은 패턴이면,
 * 기존 학습의 sourceThesisIds에 추가하고 hitCount/missCount를 재계산한다.
 * 이를 통해 기존 학습이 자연 성장하여 성숙도 게이트를 통과할 수 있다.
 *
 * NOTE: in-memory의 remainingLearnings도 함께 갱신하여
 * 이후 단계(existingSourceIds 계산)에 반영한다.
 */
export async function absorbNewTheses(
  learnings: typeof agentLearnings.$inferSelect[],
  allJudgedTheses: typeof theses.$inferSelect[],
  today: string,
): Promise<number> {
  // caution 카테고리는 failure_patterns에서 별도 관리
  const confirmedLearnings = learnings.filter((l) => l.category === "confirmed");
  if (confirmedLearnings.length === 0) return 0;

  // 모든 활성 학습의 sourceThesisIds를 수집
  const allExistingIds = new Set<number>();
  const learningSourceMap = new Map<number, Set<number>>();
  for (const learning of confirmedLearnings) {
    let sourceIds: number[];
    try {
      sourceIds = JSON.parse(learning.sourceThesisIds ?? "[]") as number[];
    } catch {
      sourceIds = [];
    }
    const idSet = new Set(sourceIds);
    learningSourceMap.set(learning.id, idSet);
    for (const id of sourceIds) {
      allExistingIds.add(id);
    }
  }

  // 기존 학습의 persona+metric 추출 (sourceThesisIds의 thesis에서)
  const thesisById = new Map(allJudgedTheses.map((t) => [t.id, t]));

  // learning → persona+metric 키 매핑
  const learningKeyMap = new Map<number, string>();
  for (const learning of confirmedLearnings) {
    const sourceIds = learningSourceMap.get(learning.id) ?? new Set();
    // sourceThesisIds에서 첫 번째 thesis의 persona+metric으로 키 결정
    for (const id of sourceIds) {
      const t = thesisById.get(id);
      if (t != null) {
        const key = `${t.agentPersona}::${normalizeMetricKey(t.verificationMetric)}`;
        learningKeyMap.set(learning.id, key);
        break;
      }
    }
  }

  // persona+metric → learningId 역매핑 (한 패턴에 여러 학습 가능하나, 첫 번째만 흡수)
  const keyToLearningId = new Map<string, number>();
  for (const [learningId, key] of learningKeyMap.entries()) {
    if (!keyToLearningId.has(key)) {
      keyToLearningId.set(key, learningId);
    }
  }

  // 아직 어떤 학습에도 속하지 않은 thesis를 기존 학습에 흡수
  const toAbsorb = new Map<number, number[]>(); // learningId → [thesisId, ...]

  for (const t of allJudgedTheses) {
    if (allExistingIds.has(t.id)) continue;
    if (t.status !== "CONFIRMED" && t.status !== "INVALIDATED" && t.status !== "EXPIRED") continue;

    const key = `${t.agentPersona}::${normalizeMetricKey(t.verificationMetric)}`;
    const learningId = keyToLearningId.get(key);
    if (learningId == null) continue;

    const existing = toAbsorb.get(learningId) ?? [];
    existing.push(t.id);
    toAbsorb.set(learningId, existing);
  }

  if (toAbsorb.size === 0) return 0;

  // DB 업데이트: sourceThesisIds 확장 + stats 재계산
  const confirmedIds = new Set(allJudgedTheses.filter((t) => t.status === "CONFIRMED").map((t) => t.id));
  const negativeIds = new Set(allJudgedTheses.filter((t) => t.status === "INVALIDATED" || t.status === "EXPIRED").map((t) => t.id));

  let totalAbsorbed = 0;

  const entries = Array.from(toAbsorb.entries());
  for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
    const batch = entries.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async ([learningId, newIds]) => {
        const existingIds = learningSourceMap.get(learningId) ?? new Set();
        const mergedIds = new Set([...existingIds, ...newIds]);
        const mergedArray = Array.from(mergedIds);

        const hits = mergedArray.filter((id) => confirmedIds.has(id)).length;
        const misses = mergedArray.filter((id) => negativeIds.has(id)).length;
        const total = hits + misses;
        const hitRate = total > 0 ? hits / total : null;

        // principle 텍스트 갱신
        const learning = learnings.find((l) => l.id === learningId);
        const key = learningKeyMap.get(learningId);
        let principle = learning?.principle ?? "";
        if (key != null) {
          const [persona, metric] = key.split("::");
          const sanitizedMetric = metric.replace(/[\n\r]/g, " ").slice(0, 100);
          principle = `[${persona}] ${sanitizedMetric} 관련 전망이 ${hits}회 적중 (적중률 ${hitRate != null ? (hitRate * 100).toFixed(0) : 0}%, ${total}회 관측)`;
        }

        await db
          .update(agentLearnings)
          .set({
            sourceThesisIds: JSON.stringify(mergedArray),
            hitCount: hits,
            missCount: misses,
            hitRate: hitRate != null ? String(hitRate.toFixed(2)) : null,
            lastVerified: today,
            principle,
          })
          .where(eq(agentLearnings.id, learningId));

        // in-memory 갱신 (이후 단계에서 existingSourceIds 재계산에 반영)
        if (learning != null) {
          learning.sourceThesisIds = JSON.stringify(mergedArray);
          learning.hitCount = hits;
          learning.missCount = misses;
          learning.hitRate = hitRate != null ? String(hitRate.toFixed(2)) : null;
          learning.lastVerified = today;
          learning.principle = principle;
        }

        totalAbsorbed += newIds.length;
        logger.info(TAG, `  ABSORBED ${newIds.length} theses into learning #${learningId} (hits=${hits}, misses=${misses})`);
      }),
    );
  }

  return totalAbsorbed;
}

/**
 * 검증된 thesis에서 persona + verificationMetric 기준으로
 * 반복 패턴을 그룹화하여 승격 후보 생성.
 *
 * activeLearningCount에 따라 graduated threshold가 적용된다.
 * binomialTest는 모든 단계에서 유지한다.
 */
export function buildPromotionCandidates(
  confirmedTheses: typeof theses.$inferSelect[],
  invalidatedTheses: typeof theses.$inferSelect[],
  existingSourceIds: Set<number>,
  activeLearningCount: number = 0,
): PromotionCandidate[] {
  const thresholds = getPromotionThresholds(activeLearningCount);
  // persona + 정규화된 metric 기준 그룹화 (기존 learning에 없는 thesis만)
  const groups = new Map<string, { confirmed: typeof theses.$inferSelect[]; invalidated: typeof theses.$inferSelect[] }>();

  for (const t of confirmedTheses) {
    if (existingSourceIds.has(t.id)) continue;
    const normalizedMetric = normalizeMetricKey(t.verificationMetric);
    const key = `${t.agentPersona}::${normalizedMetric}`;
    const group = groups.get(key) ?? { confirmed: [], invalidated: [] };
    group.confirmed.push(t);
    groups.set(key, group);
  }

  for (const t of invalidatedTheses) {
    if (existingSourceIds.has(t.id)) continue;
    const normalizedMetric = normalizeMetricKey(t.verificationMetric);
    const key = `${t.agentPersona}::${normalizedMetric}`;
    const group = groups.get(key);
    if (group != null) {
      group.invalidated.push(t);
    }
  }

  // 진단 로그: 그룹 분포 출력 (승격 실패 디버깅용)
  logger.info(TAG, `Candidate groups: ${groups.size} (thresholds: minHits=${thresholds.minHits}, minTotal=${thresholds.minTotal}, minHitRate=${(thresholds.minHitRate * 100).toFixed(0)}%)`);
  for (const [key, g] of groups.entries()) {
    const total = g.confirmed.length + g.invalidated.length;
    const hitRate = total > 0 ? g.confirmed.length / total : 0;
    logger.info(TAG, `  GROUP: ${key} — hits=${g.confirmed.length}, misses=${g.invalidated.length}, total=${total}, hitRate=${(hitRate * 100).toFixed(0)}%`);
  }

  return Array.from(groups.entries())
    .filter(([key, g]) => {
      const total = g.confirmed.length + g.invalidated.length;
      const hitRate = total > 0 ? g.confirmed.length / total : 0;

      // graduated threshold: 활성 학습 건수에 따라 기준이 자동 조정됨
      if (g.confirmed.length < thresholds.minHits) return false;
      if (hitRate < thresholds.minHitRate) return false;
      if (total < thresholds.minTotal) return false;

      // 통계적 유의성 검증 (자기확증편향 방지)
      // bootstrap 단계에서는 소표본 한계로 binomial test를 면제한다
      if (thresholds.skipBinomialTest) {
        logger.info(TAG, `  BOOTSTRAP: ${key} — binomial test 면제 (활성 학습 ${activeLearningCount}건)`);
      } else {
        const test = binomialTest(g.confirmed.length, total);
        if (!test.isSignificant) {
          logger.info(TAG, `  SKIP (not significant): ${key} p=${test.pValue.toFixed(4)}, h=${test.cohenH.toFixed(2)}`);
          return false;
        }
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

export async function promoteNewLearnings(
  candidates: PromotionCandidate[],
  currentActiveCount: number,
  today: string,
  bearPriority: boolean = false,
): Promise<number> {
  const slotsAvailable = MAX_ACTIVE_LEARNINGS - currentActiveCount;
  if (slotsAvailable <= 0 || candidates.length === 0) return 0;

  // 적중률 높은 순으로 정렬, bear-priority 시 bear 키워드 포함 후보를 우선 배치
  const sorted = [...candidates].sort((a, b) => {
    const rateA = a.hitCount / (a.hitCount + a.missCount);
    const rateB = b.hitCount / (b.hitCount + b.missCount);

    if (bearPriority) {
      const aIsBear = BEAR_KEYWORDS_FOR_PRIORITY.some((kw) => a.metric.includes(kw));
      const bIsBear = BEAR_KEYWORDS_FOR_PRIORITY.some((kw) => b.metric.includes(kw));
      if (aIsBear !== bIsBear) return aIsBear ? -1 : 1;
    }

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

// ─── Learning Loop Healthcheck ────────────────────────────────────────────────

const HEALTHCHECK_STALE_DAYS = 7;

/**
 * 학습 루프 헬스체크.
 *
 * - 활성 학습 0건: 즉시 경고
 * - 최근 7일간 신규/업데이트 학습 0건: 루프 정체 경고
 */
/**
 * 학습 추출률 기준 — 이 비율 미만이면 경고.
 * 판정 완료 thesis 대비 활성 학습 비율.
 */
const MIN_EXTRACTION_RATE = 0.20;

export async function checkLearningLoopHealth(
  activeLearningCount: number,
  today: string,
  totalJudgedTheses?: number,
): Promise<void> {
  if (activeLearningCount === 0) {
    const [confirmedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(theses)
      .where(inArray(theses.status, ["CONFIRMED", "INVALIDATED"]));

    const resolvedCount = confirmedCount?.count ?? 0;

    logger.warn(
      TAG,
      `⚠️ LEARNING LOOP HEALTH: 활성 학습 0건. 해소된 thesis ${resolvedCount}건이 학습으로 전환되지 않음. ` +
      `원인: 그룹핑 임계값 미달 또는 verificationMetric 다양성 초과. ` +
      `promote-learnings 로그에서 SKIP/BOOTSTRAP 항목 확인 필요.`,
    );
    return;
  }

  // 추출률 경고 (#427)
  if (totalJudgedTheses != null && totalJudgedTheses > 0) {
    const extractionRate = activeLearningCount / totalJudgedTheses;
    logger.info(TAG, `Extraction rate: ${activeLearningCount}/${totalJudgedTheses} = ${(extractionRate * 100).toFixed(1)}%`);
    if (extractionRate < MIN_EXTRACTION_RATE) {
      logger.warn(
        TAG,
        `⚠️ LOW EXTRACTION RATE: ${(extractionRate * 100).toFixed(1)}% < ${(MIN_EXTRACTION_RATE * 100).toFixed(0)}%. ` +
        `판정 완료 ${totalJudgedTheses}건 대비 활성 학습 ${activeLearningCount}건. 학습 흡수 파이프라인 점검 필요.`,
      );
    }
  }

  // 최근 7일간 업데이트 없는지 확인
  const staleDate = new Date(today);
  staleDate.setDate(staleDate.getDate() - HEALTHCHECK_STALE_DAYS);
  const staleDateStr = staleDate.toISOString().slice(0, 10);

  const [recentUpdate] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentLearnings)
    .where(
      and(
        eq(agentLearnings.isActive, true),
        sql`${agentLearnings.lastVerified} >= ${staleDateStr}`,
      ),
    );

  const recentCount = recentUpdate?.count ?? 0;

  if (recentCount === 0) {
    logger.warn(
      TAG,
      `⚠️ LEARNING LOOP STALE: 최근 ${HEALTHCHECK_STALE_DAYS}일간 학습 업데이트 0건. 루프 정체 가능.`,
    );
  }
}

main().catch(async (err) => {
  logger.error(TAG, `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});
