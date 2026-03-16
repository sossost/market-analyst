import { db } from "../../db/client.js";
import { theses } from "../../db/schema/analyst.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "../logger.js";
import type { Thesis, ThesisCategory, ConsensusLevel, ConsensusHitRateRow } from "../../types/debate.js";
import { recordNarrativeChain } from "./narrativeChainService.js";
import { tryQuantitativeVerification } from "./quantitativeVerifier.js";
import type { MarketSnapshot } from "./marketDataLoader.js";

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
 */
export async function saveTheses(
  debateDate: string,
  extractedTheses: Thesis[],
): Promise<number> {
  if (extractedTheses.length === 0) {
    logger.info("ThesisStore", "No theses to save");
    return 0;
  }

  // 같은 날짜의 기존 thesis 삭제 (재실행 시 중복 방지)
  await db.delete(theses).where(eq(theses.debateDate, debateDate));

  const rows = extractedTheses.map((t) => ({
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
    status: "ACTIVE" as const,
  }));

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

  return result.length;
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
