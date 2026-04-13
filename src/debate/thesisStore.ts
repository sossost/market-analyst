import { db } from "@/db/client";
import { theses } from "@/db/schema/analyst";
import { eq, and, sql, inArray, asc, gte } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { Thesis, ThesisCategory, Confidence, ConsensusLevel, ConsensusHitRateRow, MinorityView } from "@/types/debate";
import { recordNarrativeChain } from "./narrativeChainService.js";
import { tryQuantitativeVerification, parseQuantitativeCondition } from "./quantitativeVerifier.js";
import type { MarketSnapshot } from "./marketDataLoader.js";
import type { AgentPersona } from "@/types/debate";
import { THESIS_EXPIRE_PROGRESS } from "./thesisConstants.js";
import { detectStatusQuo } from "./statusQuoDetector.js";

/**
 * 에이전트당 ACTIVE thesis 상한.
 * 초과 시 가장 오래된 thesis를 EXPIRED 처리하여 학습 루프 적체를 방지한다.
 */
export const MAX_ACTIVE_THESES_PER_AGENT = 10;

function parseConsensusScore(level: ConsensusLevel): number {
  const score = parseInt(level.split("/")[0], 10);
  if (Number.isNaN(score)) {
    throw new Error(`Invalid consensusLevel: ${level}`);
  }
  return score;
}

/**
 * Save extracted theses to DB as ACTIVE.
 * Returns count of saved theses.
 *
 * @param snapshot — optional MarketSnapshot. 있으면 각 thesis의 is_status_quo를 판별.
 *   없으면 null (backtest 등 호환).
 */
export async function saveTheses(
  debateDate: string,
  extractedTheses: Thesis[],
  snapshot?: MarketSnapshot,
): Promise<number> {
  if (extractedTheses.length === 0) {
    logger.info("ThesisStore", "No theses to save");
    return 0;
  }

  // 같은 날짜의 기존 thesis 삭제 (재실행 시 중복 방지)
  await db.delete(theses).where(eq(theses.debateDate, debateDate));

  const rows = extractedTheses.map((t) => {
    const isStatusQuo = snapshot != null
      ? detectStatusQuo(t.targetCondition, snapshot)
      : null;

    return {
      debateDate,
      agentPersona: t.agentPersona,
      thesis: t.thesis,
      timeframeDays: t.timeframeDays,
      verificationMetric: t.verificationMetric,
      targetCondition: t.targetCondition,
      invalidationCondition: t.invalidationCondition ?? null,
      confidence: t.confidence,
      consensusLevel: t.consensusLevel,
      consensusScore: parseConsensusScore(t.consensusLevel),
      category: t.category ?? "short_term_outlook",
      nextBottleneck: t.nextBottleneck ?? null,
      dissentReason: t.dissentReason ?? null,
      minorityView: t.minorityView ?? null,
      consensusUnverified: t.consensusUnverified ?? null,
      contradictionDetected: t.contradictionDetected ?? null,
      isStatusQuo,
      status: "ACTIVE" as const,
    };
  });

  // status_quo 태깅 로그
  if (snapshot != null) {
    const sqCount = rows.filter((r) => r.isStatusQuo === true).length;
    if (sqCount > 0) {
      logger.info(
        "ThesisStore",
        `Status-quo 태깅: ${sqCount}/${rows.length}건이 현상유지 예측`,
      );
    }
  }

  // 정량 파싱 가능성 검증 — 자동 검증 불가 thesis 조기 경고
  for (const t of extractedTheses) {
    const targetParsed = parseQuantitativeCondition(t.targetCondition);
    if (targetParsed == null) {
      logger.warn(
        "ThesisStore",
        `[정량 검증 불가] ${t.agentPersona}: targetCondition "${t.targetCondition}" — LLM 주관 판정 의존`,
      );
    }
  }

  const result = await db.insert(theses).values(rows).returning({ id: theses.id });
  logger.info("ThesisStore", `Saved ${result.length} theses for ${debateDate}`);

  // Record narrative chains for structural_narrative theses (error-isolated)
  const pairs = extractedTheses.map((thesis, i) => ({
    thesis,
    savedId: result[i]?.id,
  }));

  for (const { thesis, savedId } of pairs) {
    if (thesis.category === "structural_narrative" && savedId != null) {
      await recordNarrativeChain(thesis, savedId);
    }
  }

  // 에이전트별 ACTIVE 상한 적용 — 새 thesis 삽입 후 초과분 만료
  await enforceActiveThesisCap(debateDate);

  return result.length;
}

/**
 * 에이전트별 ACTIVE thesis 상한을 적용한다.
 *
 * 상한(MAX_ACTIVE_THESES_PER_AGENT) 초과 에이전트의 가장 오래된 ACTIVE thesis를
 * EXPIRED 처리하여 학습 루프 적체를 방지한다.
 *
 * Returns: 만료 처리된 thesis 수
 */
export async function enforceActiveThesisCap(today: string): Promise<number> {
  const counts = await db
    .select({
      agentPersona: theses.agentPersona,
      count: sql<number>`count(*)::int`,
    })
    .from(theses)
    .where(eq(theses.status, "ACTIVE"))
    .groupBy(theses.agentPersona);

  let totalExpired = 0;

  for (const { agentPersona, count } of counts) {
    const excess = count - MAX_ACTIVE_THESES_PER_AGENT;
    if (excess <= 0) continue;

    // 가장 오래된 ACTIVE thesis를 초과분만큼 조회
    const oldestTheses = await db
      .select({ id: theses.id })
      .from(theses)
      .where(and(eq(theses.status, "ACTIVE"), eq(theses.agentPersona, agentPersona)))
      .orderBy(asc(theses.createdAt), asc(theses.id))
      .limit(excess);

    if (oldestTheses.length === 0) continue;

    const ids = oldestTheses.map((t) => t.id);

    const result = await db
      .update(theses)
      .set({
        status: "EXPIRED",
        verificationDate: today,
        verificationResult: `ACTIVE 상한 초과 (${count}/${MAX_ACTIVE_THESES_PER_AGENT}) — 가장 오래된 thesis 만료`,
        closeReason: "cap_exceeded",
      })
      .where(and(inArray(theses.id, ids), eq(theses.status, "ACTIVE")))
      .returning({ id: theses.id });

    totalExpired += result.length;
    logger.info(
      "ThesisStore",
      `[CAP] ${agentPersona}: ${result.length}개 thesis 만료 (${count} → ${count - result.length})`,
    );
  }

  if (totalExpired > 0) {
    logger.info("ThesisStore", `ACTIVE 상한 적용 완료: ${totalExpired}개 만료`);
  }

  return totalExpired;
}

/**
 * Load active theses from DB.
 */
export async function loadActiveTheses() {
  return db
    .select()
    .from(theses)
    .where(eq(theses.status, "ACTIVE"));
}

/**
 * ACTIVE thesis 중 timeframeDays가 지난 것을 EXPIRED로 변경.
 * Returns count of expired theses.
 */
export async function expireStaleTheses(today: string): Promise<number> {
  const result = await db
    .update(theses)
    .set({
      status: "EXPIRED",
      verificationDate: today,
      closeReason: "timeframe_exceeded",
    })
    .where(
      and(
        eq(theses.status, "ACTIVE"),
        sql`${theses.debateDate}::date + ${theses.timeframeDays} * interval '1 day' <= ${today}::date`,
      ),
    )
    .returning({ id: theses.id });

  if (result.length > 0) {
    logger.info("ThesisStore", `${result.length}개 thesis 만료 처리 (${today})`);
  }

  return result.length;
}

/**
 * timeframe 초과 ACTIVE thesis에 대해 만료 전 정량 판정을 시도한다.
 *
 * 처리 순서:
 * 1. ACTIVE thesis 중 timeframeDays 초과 항목을 DB에서 조회
 * 2. 각 thesis에 대해 tryQuantitativeVerification() 시도 (snapshot이 있는 경우)
 * 3. 정량 판정 가능 → CONFIRMED 또는 INVALIDATED로 해소
 * 4. 정량 판정 불가 → EXPIRED 처리 (기존 expireStaleTheses 동작과 동일)
 *
 * LLM 검증은 사용하지 않는다 — 비용 없이 정량적으로 판단 가능한 thesis만 구제한다.
 *
 * Returns: { resolved, expired } 카운트
 */
export async function resolveOrExpireStaleTheses(
  today: string,
  snapshot?: MarketSnapshot,
): Promise<{ resolved: number; expired: number }> {
  // timeframe 초과 ACTIVE thesis 조회
  const staleRows = await db
    .select({
      id: theses.id,
      thesis: theses.thesis,
      agentPersona: theses.agentPersona,
      timeframeDays: theses.timeframeDays,
      verificationMetric: theses.verificationMetric,
      targetCondition: theses.targetCondition,
      invalidationCondition: theses.invalidationCondition,
      confidence: theses.confidence,
      consensusLevel: theses.consensusLevel,
    })
    .from(theses)
    .where(
      and(
        eq(theses.status, "ACTIVE"),
        sql`${theses.debateDate}::date + ${theses.timeframeDays} * interval '1 day' <= ${today}::date`,
      ),
    );

  if (staleRows.length === 0) {
    return { resolved: 0, expired: 0 };
  }

  // snapshot이 없으면 정량 판정 불가 → 기존 expireStaleTheses와 동일하게 일괄 처리
  if (snapshot == null) {
    const expiredCount = await expireStaleTheses(today);
    return { resolved: 0, expired: expiredCount };
  }

  logger.info("ThesisStore", `만료 대상 ${staleRows.length}개 thesis — 정량 판정 시도 중`);

  // 정량 판정 결과를 분류
  type VerifiedRow = {
    id: number;
    verdict: "CONFIRMED" | "INVALIDATED";
    reason: string;
  };

  const verifiedRows: VerifiedRow[] = [];
  const toExpireIds: number[] = [];

  for (const row of staleRows) {
    const thesisForVerification: Thesis = {
      agentPersona: row.agentPersona as Thesis["agentPersona"],
      thesis: row.thesis,
      timeframeDays: row.timeframeDays as Thesis["timeframeDays"],
      verificationMetric: row.verificationMetric,
      targetCondition: row.targetCondition,
      invalidationCondition: row.invalidationCondition ?? undefined,
      confidence: row.confidence as Thesis["confidence"],
      consensusLevel: row.consensusLevel as Thesis["consensusLevel"],
    };

    const quantResult = tryQuantitativeVerification(thesisForVerification, snapshot);

    if (quantResult != null) {
      verifiedRows.push({ id: row.id, verdict: quantResult.verdict, reason: quantResult.reason });
    } else {
      toExpireIds.push(row.id);
    }
  }

  // 정량 판정 성공 → CONFIRMED/INVALIDATED 병렬 업데이트
  const resolvedUpdates = verifiedRows.map((r) => {
    const closeReason = r.verdict === "CONFIRMED" ? "condition_met" : "condition_failed";
    return db
      .update(theses)
      .set({
        status: r.verdict,
        verificationDate: today,
        verificationResult: r.reason,
        closeReason,
        verificationMethod: "quantitative",
      })
      .where(and(eq(theses.id, r.id), eq(theses.status, "ACTIVE")));
  });

  // 정량 판정 불가 → EXPIRED 배치 업데이트 (1회 쿼리)
  const expireUpdate =
    toExpireIds.length > 0
      ? [
          db
            .update(theses)
            .set({ status: "EXPIRED", verificationDate: today, closeReason: "timeframe_exceeded" })
            .where(and(inArray(theses.id, toExpireIds), eq(theses.status, "ACTIVE"))),
        ]
      : [];

  await Promise.all([...resolvedUpdates, ...expireUpdate]);

  for (const r of verifiedRows) {
    logger.info(
      "ThesisStore",
      `Thesis #${r.id} → ${r.verdict} (만료 전 정량 판정): ${r.reason}`,
    );
    await updateMinorityViewVerdict(r.id, r.verdict);
  }

  if (toExpireIds.length > 0) {
    logger.info("ThesisStore", `Thesis [${toExpireIds.join(", ")}] → EXPIRED (정량 판정 불가)`);
  }

  const resolved = verifiedRows.length;
  const expired = toExpireIds.length;

  logger.info(
    "ThesisStore",
    `만료 대상 처리 완료: ${resolved}개 CONFIRMED/INVALIDATED, ${expired}개 EXPIRED`,
  );

  return { resolved, expired };
}

/**
 * ACTIVE thesis의 상태를 CONFIRMED 또는 INVALIDATED로 변경.
 */
export async function resolveThesis(
  thesisId: number,
  resolution: {
    status: "CONFIRMED" | "INVALIDATED";
    verificationDate: string;
    verificationResult: string;
    closeReason: string;
    verificationMethod?: "quantitative" | "llm";
  },
): Promise<void> {
  await db
    .update(theses)
    .set(resolution)
    .where(
      and(
        eq(theses.id, thesisId),
        eq(theses.status, "ACTIVE"),
      ),
    );

  logger.info("ThesisStore", `Thesis #${thesisId} → ${resolution.status}: ${resolution.closeReason}`);

  // 소수 의견이 있으면 사후 검증 업데이트
  await updateMinorityViewVerdict(thesisId, resolution.status);
}

/**
 * thesis에 원인 분석 결과를 저장.
 */
export async function saveCausalAnalysis(
  thesisId: number,
  analysis: {
    causalChain: string;
    keyFactors: string[];
    reusablePattern: string;
    lessonsLearned: string;
  },
): Promise<void> {
  await db
    .update(theses)
    .set({ causalAnalysis: JSON.stringify(analysis) })
    .where(eq(theses.id, thesisId));

  logger.info("ThesisStore", `Causal analysis saved for thesis #${thesisId}`);
}

/**
 * thesis 해소 시 소수 의견의 wasCorrect를 업데이트.
 *
 * 판정 로직:
 * - 다수 의견(thesis)이 INVALIDATED → 소수가 맞았을 가능성 (wasCorrect = true)
 * - 다수 의견(thesis)이 CONFIRMED → 소수가 틀림 (wasCorrect = false)
 */
export async function updateMinorityViewVerdict(
  thesisId: number,
  majorityVerdict: "CONFIRMED" | "INVALIDATED",
): Promise<void> {
  const rows = await db
    .select({ minorityView: theses.minorityView })
    .from(theses)
    .where(eq(theses.id, thesisId));

  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (row?.minorityView == null) return;

  const updated: MinorityView = {
    ...(row.minorityView as MinorityView),
    wasCorrect: majorityVerdict === "INVALIDATED",
  };

  await db
    .update(theses)
    .set({ minorityView: updated })
    .where(eq(theses.id, thesisId));

  logger.info(
    "ThesisStore",
    `Minority view for thesis #${thesisId}: wasCorrect=${updated.wasCorrect} (${updated.analyst}: ${updated.position})`,
  );
}

/**
 * 소수 의견 적중률 통계 — 전체 및 애널리스트별.
 */
export async function getMinorityViewStats(): Promise<{
  total: number;
  correct: number;
  incorrect: number;
  pending: number;
  hitRate: number | null;
}> {
  const rows = await db
    .select({ minorityView: theses.minorityView })
    .from(theses)
    .where(sql`${theses.minorityView} is not null`);

  let correct = 0;
  let incorrect = 0;
  let pending = 0;

  for (const row of rows) {
    const mv = row.minorityView as MinorityView | null;
    if (mv == null) continue;
    if (mv.wasCorrect === true) correct++;
    else if (mv.wasCorrect === false) incorrect++;
    else pending++;
  }

  const resolved = correct + incorrect;
  return {
    total: rows.length,
    correct,
    incorrect,
    pending,
    hitRate: resolved > 0 ? correct / resolved : null,
  };
}

/**
 * Thesis 상태별 통계 조회.
 */
export async function getThesisStats(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: theses.status,
      count: sql<number>`count(*)::int`,
    })
    .from(theses)
    .groupBy(theses.status);

  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/**
 * 카테고리별 status 집계 쿼리.
 * 반환 예: { structural_narrative: { ACTIVE: 3, CONFIRMED: 1 }, ... }
 */
export async function getThesisStatsByCategory(): Promise<
  Partial<Record<ThesisCategory, Record<string, number>>>
> {
  const rows = await db
    .select({
      category: theses.category,
      status: theses.status,
      count: sql<number>`count(*)::int`,
    })
    .from(theses)
    .groupBy(theses.category, theses.status);

  const result: Partial<Record<ThesisCategory, Record<string, number>>> = {};

  for (const r of rows) {
    const cat = (r.category ?? "short_term_outlook") as ThesisCategory;
    if (result[cat] == null) {
      result[cat] = {};
    }
    result[cat]![r.status] = r.count;
  }

  return result;
}

/**
 * 카테고리별 적중률 — status_quo 분리 집계 (#733).
 *
 * 각 카테고리에 대해:
 * - total: 전체 (CONFIRMED + INVALIDATED)
 * - statusQuo: is_status_quo=true인 CONFIRMED/INVALIDATED 수
 * - nonStatusQuo: is_status_quo=false인 CONFIRMED/INVALIDATED 수
 * - legacy: is_status_quo IS NULL인 CONFIRMED/INVALIDATED 수 (미태깅 레거시)
 * - hitRate: 전체 적중률
 * - pureHitRate: non-status_quo만의 적중률 (진짜 예측력)
 */
export interface CategoryHitRateWithStatusQuo {
  category: ThesisCategory;
  confirmed: number;
  invalidated: number;
  hitRate: number | null;
  statusQuo: { confirmed: number; invalidated: number };
  nonStatusQuo: { confirmed: number; invalidated: number };
  legacy: { confirmed: number; invalidated: number };
  pureHitRate: number | null;
}

export async function getThesisHitRateByCategory(): Promise<CategoryHitRateWithStatusQuo[]> {
  const rows = await db
    .select({
      category: theses.category,
      status: theses.status,
      isStatusQuo: theses.isStatusQuo,
      count: sql<number>`count(*)::int`,
    })
    .from(theses)
    .where(inArray(theses.status, ["CONFIRMED", "INVALIDATED"]))
    .groupBy(theses.category, theses.status, theses.isStatusQuo);

  const map = new Map<string, CategoryHitRateWithStatusQuo>();

  for (const r of rows) {
    const cat = (r.category ?? "short_term_outlook") as ThesisCategory;

    if (!map.has(cat)) {
      map.set(cat, {
        category: cat,
        confirmed: 0,
        invalidated: 0,
        hitRate: null,
        statusQuo: { confirmed: 0, invalidated: 0 },
        nonStatusQuo: { confirmed: 0, invalidated: 0 },
        legacy: { confirmed: 0, invalidated: 0 },
        pureHitRate: null,
      });
    }

    const entry = map.get(cat)!;
    const statusKey = r.status === "CONFIRMED" ? "confirmed" : "invalidated";

    entry[statusKey] += r.count;

    if (r.isStatusQuo === true) {
      entry.statusQuo[statusKey] += r.count;
    } else if (r.isStatusQuo === false) {
      entry.nonStatusQuo[statusKey] += r.count;
    } else {
      entry.legacy[statusKey] += r.count;
    }
  }

  const result: CategoryHitRateWithStatusQuo[] = [];

  for (const entry of map.values()) {
    const total = entry.confirmed + entry.invalidated;
    entry.hitRate = total > 0 ? entry.confirmed / total : null;

    const pureTotal = entry.nonStatusQuo.confirmed + entry.nonStatusQuo.invalidated;
    entry.pureHitRate = pureTotal > 0
      ? entry.nonStatusQuo.confirmed / pureTotal
      : null;

    result.push(entry);
  }

  return result;
}

/**
 * consensus_score별 CONFIRMED/INVALIDATED/EXPIRED 수 집계.
 * consensus_score IS NOT NULL 조건으로 기존 rows 제외.
 */
export async function getConsensusByHitRate(): Promise<ConsensusHitRateRow[]> {
  const rows = await db
    .select({
      consensusScore: theses.consensusScore,
      confirmed: sql<number>`count(*) filter (where ${theses.status} = 'CONFIRMED')::int`,
      invalidated: sql<number>`count(*) filter (where ${theses.status} = 'INVALIDATED')::int`,
      expired: sql<number>`count(*) filter (where ${theses.status} = 'EXPIRED')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(theses)
    .where(sql`${theses.consensusScore} is not null`)
    .groupBy(theses.consensusScore)
    .orderBy(theses.consensusScore);

  return rows.map((r) => ({
    consensusScore: r.consensusScore!,
    confirmed: r.confirmed,
    invalidated: r.invalidated,
    expired: r.expired,
    total: r.total,
  }));
}

/**
 * Confidence별 적중률 통계.
 */
export async function getConfidenceHitRates(): Promise<
  Array<{ confidence: Confidence; confirmed: number; invalidated: number; hitRate: number | null }>
> {
  const rows = await db
    .select({
      confidence: theses.confidence,
      confirmed: sql<number>`count(*) filter (where ${theses.status} = 'CONFIRMED')::int`,
      invalidated: sql<number>`count(*) filter (where ${theses.status} = 'INVALIDATED')::int`,
    })
    .from(theses)
    .where(inArray(theses.status, ["CONFIRMED", "INVALIDATED"]))
    .groupBy(theses.confidence);

  return rows.map((r) => {
    const total = r.confirmed + r.invalidated;
    return {
      confidence: r.confidence as Confidence,
      confirmed: r.confirmed,
      invalidated: r.invalidated,
      hitRate: total > 0 ? r.confirmed / total : null,
    };
  });
}

/**
 * Stale thesis 강제 만료 진행률 임계.
 * THESIS_EXPIRE_PROGRESS와 동일 값을 사용하여 LLM 경로와 안전망 경로가
 * 같은 임계치에서 동작하도록 한다.
 * verifyTheses()가 실패해도 독립적으로 동작하는 안전망.
 */
export const STALE_EXPIRE_PROGRESS = THESIS_EXPIRE_PROGRESS;

/**
 * ACTIVE thesis 중 진행률이 STALE_EXPIRE_PROGRESS 이상이면서
 * 아직 timeframe을 초과하지 않은 thesis를 만료한다.
 *
 * timeframe 초과 thesis는 expireStaleTheses()가 별도 처리하므로 여기선 제외.
 * LLM 검증 실패 시에도 독립적으로 stale thesis를 포착하는 안전망 역할.
 *
 * Returns: 만료 처리된 thesis 수
 */
export async function expireStalledTheses(today: string): Promise<number> {
  const result = await db
    .update(theses)
    .set({
      status: "EXPIRED",
      verificationDate: today,
      verificationResult: `진행률 ${STALE_EXPIRE_PROGRESS * 100}%+ 무판정 — 안전망 만료`,
      closeReason: "stale_no_resolution",
    })
    .where(
      and(
        eq(theses.status, "ACTIVE"),
        // 진행률 >= STALE_EXPIRE_PROGRESS (50%) — FLOOR로 정수 일수 변환
        sql`${theses.debateDate}::date + FLOOR(${theses.timeframeDays} * ${STALE_EXPIRE_PROGRESS}::numeric)::int * interval '1 day' <= ${today}::date`,
        // timeframe 미초과 (초과분은 expireStaleTheses가 처리)
        sql`${theses.debateDate}::date + ${theses.timeframeDays} * interval '1 day' > ${today}::date`,
      ),
    )
    .returning({ id: theses.id });

  if (result.length > 0) {
    logger.info(
      "ThesisStore",
      `${result.length}개 thesis stale 만료 (진행률 ${STALE_EXPIRE_PROGRESS * 100}%+ 무판정): [${result.map((r) => r.id).join(", ")}]`,
    );
  }

  return result.length;
}

const PERSONA_LABEL: Record<string, string> = {
  macro: "매크로 이코노미스트",
  tech: "테크 애널리스트",
  geopolitics: "지정학 전략가",
  sentiment: "시장 심리 분석가",
};

const CATEGORY_LABEL: Record<ThesisCategory, string> = {
  structural_narrative: "STRUCTURAL",
  sector_rotation: "ROTATION",
  short_term_outlook: "SHORT",
};

/**
 * ACTIVE theses를 주간 에이전트 프롬프트용 텍스트로 변환.
 * 빈 배열이면 빈 문자열 반환.
 */
export function formatThesesForPrompt(
  rows: Awaited<ReturnType<typeof loadActiveTheses>>,
): string {
  if (rows.length === 0) return "";

  const lines: string[] = [];

  for (const t of rows) {
    const persona = PERSONA_LABEL[t.agentPersona] ?? t.agentPersona;
    const conf = t.confidence === "high" ? "HIGH" : t.confidence === "medium" ? "MED" : "LOW";
    const catLabel = CATEGORY_LABEL[t.category as ThesisCategory] ?? "SHORT";
    lines.push(
      `- [${catLabel}][${conf}/${t.consensusLevel}] ${persona}: ${t.thesis} (${t.timeframeDays}일, 검증: ${t.verificationMetric} ${t.targetCondition})`,
    );
  }

  return lines.join("\n");
}

/**
 * ID 배열 기반 배치 EXPIRED 처리.
 * HOLD 강제 만료 등 프로그래밍 방식 만료에 사용.
 */
export async function forceExpireTheses(
  ids: number[],
  today: string,
  reason: string,
): Promise<number> {
  if (ids.length === 0) return 0;

  const result = await db
    .update(theses)
    .set({
      status: "EXPIRED",
      verificationDate: today,
      verificationResult: reason,
      closeReason: "hold_override",
      verificationMethod: "llm",
    })
    .where(and(inArray(theses.id, ids), eq(theses.status, "ACTIVE")))
    .returning({ id: theses.id });

  logger.info("ThesisStore", `${result.length}개 thesis 강제 만료: [${result.map((r) => r.id).join(", ")}]`);
  return result.length;
}

/**
 * 최근 N일 ACTIVE/CONFIRMED thesis를 조회한다 (#764).
 * Round 3 모더레이터 프롬프트에 주입하여 의미적 중복 생성을 방지.
 *
 * @param today YYYY-MM-DD 형식 날짜
 * @param lookbackDays 조회 범위 (기본 7일)
 */
export const DEDUP_LOOKBACK_DAYS = 7;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function loadRecentThesesForDedup(
  today: string,
  lookbackDays: number = DEDUP_LOOKBACK_DAYS,
): Promise<Awaited<ReturnType<typeof loadActiveTheses>>> {
  if (!DATE_PATTERN.test(today)) {
    throw new Error(`Invalid date format for dedup query: ${today}`);
  }

  const cutoff = sql`(${today}::date - ${lookbackDays} * interval '1 day')::date`;

  return db
    .select()
    .from(theses)
    .where(
      and(
        inArray(theses.status, ["ACTIVE", "CONFIRMED"]),
        gte(theses.createdAt, cutoff),
      ),
    );
}

/**
 * 기존 thesis를 Round 3 모더레이터 프롬프트용 텍스트로 변환 (#764).
 * 에이전트별로 그룹화하여 모더레이터가 중복을 식별할 수 있게 한다.
 * 빈 배열이면 빈 문자열 반환.
 */
export function formatExistingThesesForSynthesis(
  rows: Awaited<ReturnType<typeof loadActiveTheses>>,
): string {
  if (rows.length === 0) return "";

  // 에이전트별 그룹화
  const byPersona = new Map<string, typeof rows>();
  for (const t of rows) {
    const existing = byPersona.get(t.agentPersona) ?? [];
    existing.push(t);
    byPersona.set(t.agentPersona, existing);
  }

  const sections: string[] = [];

  for (const [persona, personaTheses] of byPersona) {
    const label = PERSONA_LABEL[persona] ?? persona;
    const lines = personaTheses.map((t) => {
      const catLabel = CATEGORY_LABEL[t.category as ThesisCategory] ?? "SHORT";
      const status = t.status === "ACTIVE" ? "ACTIVE" : "CONFIRMED";
      return `  - [${catLabel}][${status}] ${t.thesis.replace(/\n/g, " ")} (${t.timeframeDays}일, 검증: ${t.verificationMetric} ${t.targetCondition})`;
    });
    sections.push(`**${label}**:\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * 에이전트(persona)별 status 집계 조회.
 * 반환 예: { tech: { ACTIVE: 16, CONFIRMED: 4 }, macro: { ACTIVE: 5, ... } }
 */
export async function getThesisStatsByPersona(): Promise<
  Partial<Record<AgentPersona, Record<string, number>>>
> {
  const rows = await db
    .select({
      persona: theses.agentPersona,
      status: theses.status,
      count: sql<number>`count(*)::int`,
    })
    .from(theses)
    .groupBy(theses.agentPersona, theses.status);

  const result: Partial<Record<AgentPersona, Record<string, number>>> = {};

  for (const r of rows) {
    const persona = r.persona as AgentPersona;
    if (result[persona] == null) {
      result[persona] = {};
    }
    result[persona]![r.status] = r.count;
  }

  return result;
}
