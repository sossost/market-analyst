import { db, pool } from "@/db/client";
import { recommendations, recommendationFactors } from "@/db/schema/analyst";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateString, validateSymbol, validateNumber, MIN_PHASE, MIN_RS_SCORE } from "./validation";
import { loadConfirmedRegime } from "../debate/regimeStore";
import { logger } from "@/agent/logger";

interface RecommendationInput {
  symbol: string;
  entry_price: number;
  phase: number;
  prev_phase?: number;
  rs_score: number;
  sector: string;
  industry: string;
  reason: string;
}

const SUBSTANDARD_TAG = "[기준 미달]";
const PERSISTENCE_TAG = "[지속성 미확인]";

/** LLM 진입가와 DB 종가의 허용 괴리 비율 (10%) */
const PRICE_DIVERGENCE_THRESHOLD = 0.1;

/** EARLY_BEAR / BEAR 레짐에서 신규 추천을 전면 차단하는 레짐 집합 */
const BEAR_REGIMES = new Set(["EARLY_BEAR", "BEAR"]);

/** 동일 symbol의 재추천을 막는 쿨다운 기간 (캘린더일) */
const COOLDOWN_CALENDAR_DAYS = 7;

/** Phase 2 지속성 판단 기준 기간 (캘린더일) */
const PHASE2_PERSISTENCE_DAYS = 5;

/** Phase 2 지속성을 충족하는 최소 데이터 포인트 수 */
const MIN_PHASE2_PERSISTENCE_COUNT = 2;

/**
 * Phase < 2 또는 RS < 60인 종목의 reason에 [기준 미달] 접두사를 추가한다.
 * 이미 태그가 있거나 기준을 충족하면 원본을 그대로 반환한다.
 */
export function tagSubstandardReason(
  reason: string | null | undefined,
  phase: number | null | undefined,
  rsScore: number | null | undefined,
): string | null {
  const isSubstandard =
    (phase != null && phase < MIN_PHASE) ||
    (rsScore != null && rsScore < MIN_RS_SCORE);

  if (isSubstandard === false) {
    return reason ?? null;
  }

  if (reason == null || reason === "") {
    return `${SUBSTANDARD_TAG} 사유 미기재`;
  }

  if (reason.startsWith(SUBSTANDARD_TAG)) {
    return reason;
  }

  return `${SUBSTANDARD_TAG} ${reason}`;
}

/**
 * Phase 2 지속성이 부족한 종목의 reason에 [지속성 미확인] 접두사를 추가한다.
 * 이미 태그가 있으면 원본을 그대로 반환한다. 차단이 아닌 소프트 태깅.
 */
export function tagPersistenceReason(reason: string | null | undefined): string {
  const base = reason ?? "";

  if (base.startsWith(PERSISTENCE_TAG)) {
    return base;
  }

  return `${PERSISTENCE_TAG} ${base}`.trim();
}

/**
 * 에이전트가 추천 종목을 DB에 저장하는 도구.
 * 멱등: 동일 (symbol, date)는 onConflictDoNothing.
 */
export const saveRecommendations: AgentTool = {
  definition: {
    name: "save_recommendations",
    description:
      "이번 분석에서 선정한 추천 종목을 DB에 저장합니다. 추천 종목의 성과를 자동 트래킹하기 위해 반드시 호출하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "추천일 (YYYY-MM-DD)",
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              entry_price: {
                type: "number",
                description: "진입가 (당일 종가)",
              },
              phase: { type: "number" },
              prev_phase: { type: "number" },
              rs_score: { type: "number" },
              sector: { type: "string" },
              industry: { type: "string" },
              reason: { type: "string" },
            },
            required: [
              "symbol",
              "entry_price",
              "phase",
              "rs_score",
              "sector",
              "industry",
              "reason",
            ],
          },
        },
      },
      required: ["date", "recommendations"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date" });
    }

    const recs = input.recommendations as RecommendationInput[] | undefined;
    if (!Array.isArray(recs) || recs.length === 0) {
      return JSON.stringify({ error: "recommendations must be a non-empty array" });
    }

    // Phase 1: 레짐 하드 게이트 — 확정 레짐만 조회 (pending 제외)
    let currentRegime: string | null = null;
    try {
      const confirmed = await loadConfirmedRegime();
      currentRegime = confirmed?.regime ?? null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("Regime", `레짐 조회 실패, null로 저장: ${reason}`);
    }

    if (currentRegime != null && BEAR_REGIMES.has(currentRegime)) {
      const totalCount = recs.length;
      logger.warn(
        "QualityGate",
        `레짐 ${currentRegime} — 전체 추천 배치 ${totalCount}개 차단`,
      );
      return JSON.stringify({
        success: false,
        savedCount: 0,
        skippedCount: 0,
        blockedByRegime: totalCount,
        blockedByCooldown: 0,
        message: `레짐 ${currentRegime}: 전체 ${totalCount}개 추천 차단`,
      });
    }

    const symbols = recs
      .map((r) => validateSymbol(r.symbol))
      .filter((s): s is string => s != null);

    // Phase 2: 쿨다운 게이트 + 중복 추천 방지 병렬 조회
    const cooldownStart = getCooldownStart(date, COOLDOWN_CALENDAR_DAYS);

    const [{ rows: activeRows }, { rows: cooldownRows }] = await Promise.all([
      retryDatabaseOperation(() =>
        pool.query<{ symbol: string }>(
          `SELECT symbol FROM recommendations WHERE status = 'ACTIVE' AND symbol = ANY($1)`,
          [symbols],
        ),
      ),
      retryDatabaseOperation(() =>
        pool.query<{ symbol: string }>(
          `SELECT DISTINCT symbol FROM recommendations
           WHERE status IN ('CLOSED', 'CLOSED_PHASE_EXIT')
             AND recommendation_date >= $1
             AND symbol = ANY($2)`,
          [cooldownStart, symbols],
        ),
      ),
    ]);

    const activeSymbols = new Set(activeRows.map((r) => r.symbol));
    const cooldownSymbols = new Set(cooldownRows.map((r) => r.symbol));

    // Phase 3: Phase 2 지속성 확인 — 최근 5 캘린더일 내 phase >= 2 행 수 조회
    const persistenceStart = getPersistenceStart(date, PHASE2_PERSISTENCE_DAYS);
    const { rows: persistenceRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; phase2_count: string }>(
        `SELECT symbol, COUNT(*) AS phase2_count
         FROM stock_phases
         WHERE symbol = ANY($1)
           AND date >= $2
           AND date <= $3
           AND phase >= 2
         GROUP BY symbol`,
        [symbols, persistenceStart, date],
      ),
    );
    const persistenceMap = new Map(
      persistenceRows.map((r) => [r.symbol, Number(r.phase2_count)]),
    );

    // 진입가 검증: 추천일 종가 사전 일괄 조회
    const { rows: priceRows } = await retryDatabaseOperation(() =>
      pool.query<{ symbol: string; close: string }>(
        `SELECT symbol, close FROM daily_prices WHERE symbol = ANY($1) AND date = $2`,
        [symbols, date],
      ),
    );
    const dbPriceMap = new Map(
      priceRows.map((r) => [r.symbol, toNum(r.close)]),
    );

    let savedCount = 0;
    let skippedCount = 0;
    let blockedByCooldown = 0;

    for (const rec of recs) {
      const symbol = validateSymbol(rec.symbol);
      if (symbol == null) {
        skippedCount++;
        continue;
      }

      // 중복 추천 방지: ACTIVE 상태인 symbol 스킵
      if (activeSymbols.has(symbol)) {
        logger.warn("Duplicate", `${symbol}: 이미 ACTIVE 추천 존재, 스킵`);
        skippedCount++;
        continue;
      }

      // Phase 2: 쿨다운 게이트
      if (cooldownSymbols.has(symbol)) {
        logger.warn(
          "QualityGate",
          `${symbol}: 쿨다운 기간(${COOLDOWN_CALENDAR_DAYS}일) 내 CLOSED 이력, 스킵`,
        );
        blockedByCooldown++;
        continue;
      }

      const llmPrice = toNum(rec.entry_price);
      if (llmPrice === 0) {
        skippedCount++;
        continue;
      }

      // 진입가 2중 방어: DB 종가와 비교 후 교정
      let entryPrice = llmPrice;
      const dbPrice = dbPriceMap.get(symbol);

      if (dbPrice == null || dbPrice === 0) {
        logger.warn(
          "Price",
          `${symbol}: daily_prices에 ${date} 종가 없음, LLM 값 ${llmPrice} 사용`,
        );
      } else {
        const divergence = Math.abs(llmPrice - dbPrice) / dbPrice;
        if (divergence >= PRICE_DIVERGENCE_THRESHOLD) {
          logger.warn(
            "Price",
            `${symbol}: LLM 진입가 ${llmPrice} → DB 종가 ${dbPrice}로 교정`,
          );
          entryPrice = dbPrice;
        }
      }

      // 기준 미달 태깅 (Phase < 2 또는 RS < 60)
      let taggedReason = tagSubstandardReason(rec.reason, rec.phase, rec.rs_score);

      // Phase 3: Phase 2 지속성 소프트 태깅
      const phase2Count = persistenceMap.get(symbol) ?? 0;
      if (phase2Count < MIN_PHASE2_PERSISTENCE_COUNT) {
        logger.warn(
          "QualityGate",
          `${symbol}: Phase 2 지속성 ${phase2Count}일 (기준 ${MIN_PHASE2_PERSISTENCE_COUNT}일 미만), [지속성 미확인] 태깅`,
        );
        taggedReason = tagPersistenceReason(taggedReason ?? rec.reason);
      }

      // 1. recommendations 테이블 INSERT
      const insertResult = await retryDatabaseOperation(() =>
        db
          .insert(recommendations)
          .values({
            symbol,
            recommendationDate: date,
            entryPrice: String(entryPrice),
            entryRsScore: rec.rs_score ?? null,
            entryPhase: rec.phase ?? 2,
            entryPrevPhase: rec.prev_phase ?? null,
            sector: rec.sector ?? null,
            industry: rec.industry ?? null,
            reason: taggedReason,
            marketRegime: currentRegime,
            status: "ACTIVE",
            currentPrice: String(entryPrice),
            currentPhase: rec.phase ?? 2,
            currentRsScore: rec.rs_score ?? null,
            pnlPercent: "0",
            maxPnlPercent: "0",
            daysHeld: 0,
            lastUpdated: date,
          })
          .onConflictDoNothing({
            target: [recommendations.symbol, recommendations.recommendationDate],
          }),
      );

      // onConflictDoNothing returns rowCount 0 when skipped
      const rowCount = (insertResult as unknown as { rowCount: number }).rowCount ?? 1;
      if (rowCount === 0) {
        skippedCount++;
        continue;
      }

      // 2. 팩터 스냅샷 저장
      await saveFactorSnapshot(symbol, date);
      savedCount++;
    }

    return JSON.stringify({
      success: true,
      savedCount,
      skippedCount,
      blockedByRegime: 0,
      blockedByCooldown,
      message: `${savedCount}개 저장, ${skippedCount}개 스킵 (이미 존재하거나 유효하지 않음), ${blockedByCooldown}개 쿨다운 차단`,
    });
  },
};

/**
 * 쿨다운 기간 시작일 계산 (date - cooldownDays).
 * YYYY-MM-DD 형식으로 반환.
 */
function getCooldownStart(date: string, cooldownDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - cooldownDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Phase 2 지속성 확인 시작일 계산 (date - persistenceDays).
 * YYYY-MM-DD 형식으로 반환.
 */
function getPersistenceStart(date: string, persistenceDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - persistenceDays);
  return d.toISOString().slice(0, 10);
}

/**
 * stock_phases, sector_rs_daily, industry_rs_daily에서 팩터 스냅샷을 가져와 저장.
 */
async function saveFactorSnapshot(
  symbol: string,
  date: string,
): Promise<void> {
  // 독립 쿼리 3개 병렬 실행
  const [{ rows: phaseRows }, { rows: symbolRows }, { rows: breadthRows }] =
    await Promise.all([
      retryDatabaseOperation(() =>
        pool.query<{
          rs_score: number | null;
          phase: number;
          ma150_slope: string | null;
          vol_ratio: string | null;
          volume_confirmed: boolean | null;
          pct_from_high_52w: string | null;
          pct_from_low_52w: string | null;
          conditions_met: string | null;
        }>(
          `SELECT rs_score, phase, ma150_slope, vol_ratio, volume_confirmed,
                  pct_from_high_52w, pct_from_low_52w, conditions_met
           FROM stock_phases WHERE symbol = $1 AND date = $2`,
          [symbol, date],
        ),
      ),
      retryDatabaseOperation(() =>
        pool.query<{ sector: string | null; industry: string | null }>(
          `SELECT sector, industry FROM symbols WHERE symbol = $1`,
          [symbol],
        ),
      ),
      retryDatabaseOperation(() =>
        pool.query<{ phase2_ratio: string | null }>(
          `SELECT
             ROUND(COUNT(*) FILTER (WHERE phase = 2)::numeric / NULLIF(COUNT(*), 0) * 100, 1)::text AS phase2_ratio
           FROM stock_phases WHERE date = $1`,
          [date],
        ),
      ),
    ]);

  const stockFactor = phaseRows[0] ?? null;
  const symbolInfo = symbolRows[0] ?? null;
  const marketPhase2Ratio =
    breadthRows[0]?.phase2_ratio != null
      ? toNum(breadthRows[0].phase2_ratio)
      : null;

  // 섹터/업종 팩터 병렬 조회 (symbolInfo 의존)
  let sectorRs: number | null = null;
  let sectorGroupPhase: number | null = null;
  let industryRs: number | null = null;
  let industryGroupPhase: number | null = null;

  const groupQueries: Promise<void>[] = [];

  if (symbolInfo?.sector != null) {
    groupQueries.push(
      retryDatabaseOperation(() =>
        pool.query<{ avg_rs: string | null; group_phase: number | null }>(
          `SELECT avg_rs, group_phase FROM sector_rs_daily
           WHERE sector = $1 AND date = $2`,
          [symbolInfo.sector, date],
        ),
      ).then(({ rows }) => {
        if (rows[0] != null) {
          sectorRs = toNum(rows[0].avg_rs);
          sectorGroupPhase = rows[0].group_phase;
        }
      }),
    );
  }

  if (symbolInfo?.industry != null) {
    groupQueries.push(
      retryDatabaseOperation(() =>
        pool.query<{ avg_rs: string | null; group_phase: number | null }>(
          `SELECT avg_rs, group_phase FROM industry_rs_daily
           WHERE industry = $1 AND date = $2`,
          [symbolInfo.industry, date],
        ),
      ).then(({ rows }) => {
        if (rows[0] != null) {
          industryRs = toNum(rows[0].avg_rs);
          industryGroupPhase = rows[0].group_phase;
        }
      }),
    );
  }

  await Promise.all(groupQueries);

  await retryDatabaseOperation(() =>
    db
      .insert(recommendationFactors)
      .values({
        symbol,
        recommendationDate: date,
        rsScore: stockFactor?.rs_score ?? null,
        phase: stockFactor?.phase ?? null,
        ma150Slope: stockFactor?.ma150_slope ?? null,
        volRatio: stockFactor?.vol_ratio ?? null,
        volumeConfirmed: stockFactor?.volume_confirmed ?? null,
        pctFromHigh52w: stockFactor?.pct_from_high_52w ?? null,
        pctFromLow52w: stockFactor?.pct_from_low_52w ?? null,
        conditionsMet: stockFactor?.conditions_met ?? null,
        sectorRs: sectorRs != null ? String(sectorRs) : null,
        sectorGroupPhase,
        industryRs: industryRs != null ? String(industryRs) : null,
        industryGroupPhase,
        marketPhase2Ratio:
          marketPhase2Ratio != null ? String(marketPhase2Ratio) : null,
      })
      .onConflictDoNothing({
        target: [
          recommendationFactors.symbol,
          recommendationFactors.recommendationDate,
        ],
      }),
  );
}
