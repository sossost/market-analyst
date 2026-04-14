/**
 * scan-recommendation-candidates.ts — Phase 2 종목 자동 스캔 → tracked_stocks INSERT.
 *
 * 기존 recommendations INSERT에서 tracked_stocks INSERT로 전환.
 * 중복/쿨다운 체크도 tracked_stocks 기준으로 변경.
 * 게이트 로직(recommendationGates)은 동일하게 유지.
 *
 * Issue #773 — tracked_stocks 통합 ETL Phase 2
 */

import "dotenv/config";
import { db, pool } from "@/db/client";
import { recommendationFactors } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { logger } from "@/lib/logger";
import { loadConfirmedRegime, loadPendingRegimes } from "@/debate/regimeStore";
import { evaluateBearException } from "@/tools/bearExceptionGate.js";
import { evaluateLateBullGate } from "@/tools/lateBullGate.js";
import { runCorporateAnalyst } from "@/corporate-analyst/runCorporateAnalyst.js";
import {
  BEAR_REGIMES,
  COOLDOWN_CALENDAR_DAYS,
  PHASE2_PERSISTENCE_DAYS,
  PHASE2_STABILITY_DAYS,
  MIN_RS_SCORE,
  MAX_RS_SCORE,
  MIN_PRICE,
  MAX_SECTOR_RATIO,
  getDateOffset,
  evaluateLowRsGate,
  evaluateOverheatedRsGate,
  evaluateLowPriceGate,
  evaluatePersistenceGate,
  evaluateStabilityGate,
  evaluateFundamentalGate,
  applySectorCap,
} from "@/tools/recommendationGates.js";
import { findFundamentalGrades } from "@/db/repositories/fundamentalRepository.js";
import {
  findActiveTrackedStocksBySymbols,
  findRecentlyExitedBySymbols,
  insertTrackedStock,
} from "@/db/repositories/trackedStocksRepository.js";
import {
  findAllPhase2Stocks,
  findStockPhaseDetail,
  findMarketPhase2Ratio,
  findPhase2Persistence,
  findPhase2SinceDates,
  findPhase2Stability,
} from "@/db/repositories/stockPhaseRepository.js";
import {
  findSymbolMeta,
} from "@/db/repositories/symbolRepository.js";
import {
  findSectorRsByName,
  findIndustryRsByName,
} from "@/db/repositories/sectorRepository.js";
import {
  findLatestClose,
} from "@/db/repositories/priceRepository.js";

const TAG = "SCAN_RECOMMENDATION_CANDIDATES";

/**
 * ETL 자동 추천 reason 포맷.
 * 에이전트의 서술형 reason과 구분하기 위해 고정 접두사 사용.
 */
function buildEtlReason(phase: number, rsScore: number): string {
  return `[ETL 자동] Phase ${phase} RS ${rsScore} 자동 스캔`;
}

/**
 * 일간 ETL: Phase 2 종목을 전수 스캔하여 게이트 통과 종목을 recommendations에 자동 저장.
 *
 * 흐름:
 * 1. Phase 2 종목 전수 조회
 * 2. 레짐 조회 (Bear/LateBull 게이트 적용 여부 결정)
 * 3. 일괄 게이트 조회 (activeRows, cooldownRows, persistence, stability, fundamental)
 * 4. 종목별 게이트 순차 적용
 * 5. 통과 종목 INSERT (onConflictDoNothing 멱등성)
 * 6. 팩터 스냅샷 저장 + runCorporateAnalyst fire-and-forget
 */
async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  // Phase 2 종목 전수 조회
  const phase2Stocks = await retryDatabaseOperation(() =>
    findAllPhase2Stocks(targetDate),
  );

  if (phase2Stocks.length === 0) {
    logger.info(TAG, "Phase 2 종목 없음. 스킵.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Phase 2 종목 ${phase2Stocks.length}건 스캔 시작`);

  // 레짐 조회
  let marketRegimeForRecord: string | null = null;
  let regimeForGate: string | null = null;
  try {
    const confirmed = await loadConfirmedRegime();

    if (confirmed != null) {
      marketRegimeForRecord = confirmed.regime;
      regimeForGate = confirmed.regime;
    } else {
      const pendingRows = await loadPendingRegimes(1);
      const latestPending = pendingRows[0] ?? null;

      if (latestPending != null) {
        marketRegimeForRecord = latestPending.regime;
        // regimeForGate는 null 유지 — 미확정 레짐으로 Bear Gate 발동 금지
        logger.warn(
          TAG,
          `확정 레짐 없음 — pending 레짐 fallback: ${latestPending.regime}`,
        );
      } else {
        logger.warn(TAG, "확정·pending 레짐 모두 없음 — market_regime=null로 저장");
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(TAG, `레짐 조회 실패, Bear Gate 미적용: ${reason}`);
  }

  const isBearRegime = regimeForGate != null && BEAR_REGIMES.has(regimeForGate);
  const isLateBullRegime = regimeForGate === "LATE_BULL";

  const symbols = phase2Stocks.map((s) => s.symbol);

  // 일괄 게이트 조회 (4가지 + 펀더멘탈 + 가격)
  const cooldownStart = getDateOffset(targetDate, COOLDOWN_CALENDAR_DAYS);
  const persistenceStart = getDateOffset(targetDate, PHASE2_PERSISTENCE_DAYS);

  const [
    activeRows,
    cooldownRows,
    persistenceRows,
    stabilityRows,
    fundamentalGradeRows,
    priceRows,
    phase2SinceRows,
  ] = await Promise.all([
    // 중복 체크: tracked_stocks ACTIVE 기준
    retryDatabaseOperation(() => findActiveTrackedStocksBySymbols(symbols)),
    // 쿨다운 체크: tracked_stocks EXITED/EXPIRED 기준
    retryDatabaseOperation(() => findRecentlyExitedBySymbols(cooldownStart, symbols)),
    retryDatabaseOperation(() =>
      findPhase2Persistence(symbols, persistenceStart, targetDate),
    ),
    retryDatabaseOperation(() =>
      findPhase2Stability(symbols, targetDate, PHASE2_STABILITY_DAYS),
    ),
    retryDatabaseOperation(() => findFundamentalGrades(symbols, targetDate)),
    retryDatabaseOperation(() => findLatestClose(symbols, targetDate)),
    retryDatabaseOperation(() => findPhase2SinceDates(symbols, targetDate)),
  ]);

  const activeSymbols = new Set(activeRows.map((r) => r.symbol));
  const cooldownSymbols = new Set(cooldownRows.map((r) => r.symbol));
  const persistenceMap = new Map(
    persistenceRows.map((r) => [r.symbol, Number(r.phase2_count)]),
  );
  const stableSymbols = new Set(stabilityRows.map((r) => r.symbol));
  const fundamentalGradeMap = new Map(
    fundamentalGradeRows.map((r) => [r.symbol, r.grade]),
  );
  const dbPriceMap = new Map(
    priceRows.map((r) => [r.symbol, toNum(r.close)]),
  );
  const phase2SinceMap = new Map(
    phase2SinceRows.map((r) => [r.symbol, r.phase2_since]),
  );

  let skippedCount = 0;
  let blockedByRegime = 0;
  let bearExceptionCount = 0;
  let blockedByLateBull = 0;
  let lateBullPassCount = 0;
  let blockedByCooldown = 0;
  let blockedByLowRS = 0;
  let blockedByOverheatedRS = 0;
  let blockedByLowPrice = 0;
  let blockedByPersistence = 0;
  let blockedByStability = 0;
  let blockedByFundamental = 0;

  // Phase 1: 게이트 통과 후보 수집 (RS 내림차순 유지)
  interface GatePassedCandidate {
    symbol: string;
    phase: number | null;
    rs_score: number | null;
    sector: string | null;
    industry: string | null;
    prev_phase: number | null;
    entryPrice: number;
    reason: string;
  }

  const gatePassedCandidates: GatePassedCandidate[] = [];

  for (const stock of phase2Stocks) {
    // Phase 게이트 생략: findAllPhase2Stocks가 WHERE phase = 2를 보장하므로 불필요
    const { symbol, phase, rs_score, sector, industry } = stock;

    // 중복 추천 방지: ACTIVE 상태인 symbol 스킵
    if (activeSymbols.has(symbol)) {
      skippedCount++;
      continue;
    }

    // 쿨다운 게이트
    if (cooldownSymbols.has(symbol)) {
      logger.info(
        TAG,
        `${symbol}: 쿨다운 ${COOLDOWN_CALENDAR_DAYS}일 내 CLOSED 이력, 스킵`,
      );
      blockedByCooldown++;
      continue;
    }

    // Bear 레짐 게이트 — 개별 종목 예외 심사
    let bearExceptionPassed = false;
    if (isBearRegime) {
      const exceptionResult = await evaluateBearException({
        symbol,
        sector: sector ?? "",
        industry: industry ?? null,
        date: targetDate,
        regime: regimeForGate ?? undefined,
        rsScore: rs_score ?? null,
        isStable: stableSymbols.has(symbol),
      });

      if (!exceptionResult.passed) {
        logger.info(
          TAG,
          `${symbol}: 레짐 ${regimeForGate} Bear 차단 — ${exceptionResult.reason}`,
        );
        blockedByRegime++;
        continue;
      }

      bearExceptionPassed = true;
      bearExceptionCount++;
    }

    // Late Bull 감쇠 게이트
    let lateBullPassed = false;
    if (isLateBullRegime) {
      const gateResult = await evaluateLateBullGate({
        symbol,
        rsScore: rs_score ?? 0,
        date: targetDate,
      });

      if (!gateResult.passed) {
        logger.info(
          TAG,
          `${symbol}: 레짐 ${regimeForGate} Late Bull 차단 — ${gateResult.reason}`,
        );
        blockedByLateBull++;
        continue;
      }

      lateBullPassed = true;
      lateBullPassCount++;
    }

    // RS 하한 게이트
    const lowRsGate = evaluateLowRsGate(rs_score);
    if (!lowRsGate.passed) {
      logger.info(TAG, `${symbol}: ${lowRsGate.reason}, 스킵`);
      blockedByLowRS++;
      continue;
    }

    // RS 과열 게이트
    const overheatedRsGate = evaluateOverheatedRsGate(rs_score);
    if (!overheatedRsGate.passed) {
      logger.info(TAG, `${symbol}: ${overheatedRsGate.reason}, 스킵`);
      blockedByOverheatedRS++;
      continue;
    }

    // 진입가: DB 종가 사용 (ETL은 LLM 입력 없음)
    const entryPrice = dbPriceMap.get(symbol) ?? null;
    if (entryPrice == null || entryPrice === 0) {
      logger.info(TAG, `${symbol}: 종가 데이터 없음, 스킵`);
      skippedCount++;
      continue;
    }

    // 저가주 게이트
    const lowPriceGate = evaluateLowPriceGate(entryPrice);
    if (!lowPriceGate.passed) {
      logger.info(TAG, `${symbol}: ${lowPriceGate.reason}, 스킵`);
      blockedByLowPrice++;
      continue;
    }

    // Phase 2 지속성 게이트
    const phase2Count = persistenceMap.get(symbol) ?? 0;
    const persistenceGate = evaluatePersistenceGate(phase2Count);
    if (!persistenceGate.passed) {
      logger.info(TAG, `${symbol}: ${persistenceGate.reason}, 스킵`);
      blockedByPersistence++;
      continue;
    }

    // Phase 2 안정성 게이트
    const stabilityGate = evaluateStabilityGate(stableSymbols.has(symbol));
    if (!stabilityGate.passed) {
      logger.info(TAG, `${symbol}: ${stabilityGate.reason}, 스킵`);
      blockedByStability++;
      continue;
    }

    // 펀더멘탈 게이트
    const fundamentalGrade = fundamentalGradeMap.get(symbol) ?? null;
    const fundamentalGate = evaluateFundamentalGate(fundamentalGrade);
    if (!fundamentalGate.passed) {
      logger.info(TAG, `${symbol}: ${fundamentalGate.reason}, 스킵`);
      blockedByFundamental++;
      continue;
    }

    // reason 구성 (Bear예외/LateBull 태깅)
    let reason = buildEtlReason(phase ?? 2, rs_score ?? 0);
    if (bearExceptionPassed) {
      reason = `[Bear 예외] ${reason}`;
    }
    if (lateBullPassed) {
      reason = `[Late Bull 감쇠] ${reason}`;
    }

    gatePassedCandidates.push({
      symbol,
      phase: phase ?? null,
      rs_score: rs_score ?? null,
      sector: sector ?? null,
      industry: industry ?? null,
      prev_phase: stock.prev_phase ?? null,
      entryPrice,
      reason,
    });
  }

  // Phase 2: 섹터 집중도 상한 적용 (#732)
  const { selected: selectedCandidates, capped: cappedCandidates } =
    applySectorCap(gatePassedCandidates, MAX_SECTOR_RATIO);

  const blockedBySectorCap = cappedCandidates.length;

  if (blockedBySectorCap > 0) {
    const cappedSymbols = cappedCandidates.map((c) => c.symbol).join(", ");
    logger.info(
      TAG,
      `섹터 상한(${MAX_SECTOR_RATIO * 100}%) 적용 — ${blockedBySectorCap}건 제외: ${cappedSymbols}`,
    );
  }

  // Phase 3: 선택된 후보만 INSERT
  let savedCount = 0;
  const corporateAnalystPromises: Promise<void>[] = [];

  for (const candidate of selectedCandidates) {
    const {
      symbol,
      phase,
      rs_score,
      sector,
      industry,
      prev_phase,
      entryPrice,
      reason,
    } = candidate;

    // featured 자동 판정: SEPA S/A 등급 시 featured
    const fundamentalGrade = fundamentalGradeMap.get(symbol) ?? null;
    const tier = fundamentalGrade != null && ["S", "A"].includes(fundamentalGrade)
      ? "featured" as const
      : "standard" as const;

    // 90일 트래킹 종료 날짜 계산
    const trackingEnd = new Date(`${targetDate}T00:00:00Z`);
    trackingEnd.setUTCDate(trackingEnd.getUTCDate() + 90);
    const trackingEndDate = trackingEnd.toISOString().slice(0, 10);

    // INSERT — tracked_stocks (UNIQUE(symbol, entry_date) 충돌 시 no-op)
    const insertedId = await retryDatabaseOperation(() =>
      insertTrackedStock({
        symbol,
        source: "etl_auto",
        tier,
        entryDate: targetDate,
        entryPrice,
        entryPhase: phase ?? 2,
        entryPrevPhase: prev_phase ?? null,
        entryRsScore: rs_score ?? null,
        entrySepaGrade: fundamentalGrade,
        entryThesisId: null,
        entrySector: sector ?? null,
        entryIndustry: industry ?? null,
        entryReason: reason,
        phase2Since: phase2SinceMap.get(symbol) ?? null,
        marketRegime: marketRegimeForRecord,
        trackingEndDate,
      }),
    );

    if (insertedId == null) {
      // 이미 존재 (에이전트가 먼저 저장한 경우)
      skippedCount++;
      continue;
    }

    // 팩터 스냅샷 저장
    await saveFactorSnapshot(symbol, targetDate);
    savedCount++;

    // 기업 분석 리포트 — pool.end() 전에 완료 보장
    corporateAnalystPromises.push(
      runCorporateAnalyst(symbol, targetDate, pool)
        .then((result) => {
          if (!result.success) {
            logger.warn(TAG, `${symbol} 리포트 생성 실패: ${result.error}`);
          }
        })
        .catch((err) =>
          logger.error(TAG, `${symbol} CorporateAnalyst 에러: ${String(err)}`),
        ),
    );
  }

  if (corporateAnalystPromises.length > 0) {
    logger.info(TAG, `CorporateAnalyst ${corporateAnalystPromises.length}건 대기 중...`);
    await Promise.allSettled(corporateAnalystPromises);
  }

  const summaryMsg =
    `완료 — 저장: ${savedCount}, 스킵: ${skippedCount}, ` +
    `Bear차단: ${blockedByRegime}, Bear예외통과: ${bearExceptionCount}, ` +
    `LateBull차단: ${blockedByLateBull}, LateBull통과: ${lateBullPassCount}, ` +
    `쿨다운차단: ${blockedByCooldown}, RS하한차단: ${blockedByLowRS}, ` +
    `RS과열차단: ${blockedByOverheatedRS}, 저가주차단: ${blockedByLowPrice}, ` +
    `지속성차단: ${blockedByPersistence}, 안정성차단: ${blockedByStability}, ` +
    `펀더멘탈차단: ${blockedByFundamental}, 섹터상한차단: ${blockedBySectorCap}`;

  logger.info(TAG, summaryMsg);

  // 추천 0건 진단 — 파이프라인 건강성 모니터링 (#711)
  if (savedCount === 0 && phase2Stocks.length > 0) {
    logger.warn(
      TAG,
      `금일 추천 0건 — 레짐: ${regimeForGate ?? "없음"}, ` +
        `Phase2 총: ${phase2Stocks.length}, ` +
        `최다 차단: ${identifyTopBlocker(blockedByRegime, blockedByLateBull, blockedByCooldown, blockedByLowRS, blockedByOverheatedRS, blockedByLowPrice, blockedByPersistence, blockedByStability, blockedByFundamental, blockedBySectorCap)}`,
    );
  }

  await pool.end();
}

/**
 * 팩터 스냅샷 저장 — saveRecommendations.ts와 동일한 로직.
 */
async function saveFactorSnapshot(symbol: string, date: string): Promise<void> {
  const [stockFactor, symbolInfo, breadthRow] = await Promise.all([
    retryDatabaseOperation(() => findStockPhaseDetail(symbol, date)),
    retryDatabaseOperation(() => findSymbolMeta(symbol)),
    retryDatabaseOperation(() => findMarketPhase2Ratio(date)),
  ]);

  const marketPhase2Ratio =
    breadthRow.phase2_ratio != null ? toNum(breadthRow.phase2_ratio) : null;

  let sectorRs: number | null = null;
  let sectorGroupPhase: number | null = null;
  let industryRs: number | null = null;
  let industryGroupPhase: number | null = null;

  const groupQueries: Promise<void>[] = [];

  if (symbolInfo?.sector != null) {
    groupQueries.push(
      retryDatabaseOperation(() =>
        findSectorRsByName(symbolInfo.sector!, date),
      ).then((row) => {
        if (row != null) {
          sectorRs = toNum(row.avg_rs);
          sectorGroupPhase = row.group_phase;
        }
      }),
    );
  }

  if (symbolInfo?.industry != null) {
    groupQueries.push(
      retryDatabaseOperation(() =>
        findIndustryRsByName(symbolInfo.industry!, date),
      ).then((row) => {
        if (row != null) {
          industryRs = toNum(row.avg_rs);
          industryGroupPhase = row.group_phase;
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

/**
 * 게이트별 차단 수 중 최다 차단 원인을 식별한다.
 * 0건 진단 로그에서 병목 원인 파악용.
 */
function identifyTopBlocker(...counts: number[]): string {
  const labels = [
    "Bear레짐", "LateBull", "쿨다운", "RS하한", "RS과열",
    "저가주", "지속성", "안정성", "펀더멘탈", "섹터상한",
  ];

  const top = counts.reduce(
    (best, count, idx) => (count > best.count ? { count, idx } : best),
    { count: 0, idx: 0 },
  );

  return top.count > 0 ? `${labels[top.idx]}(${top.count}건)` : "없음";
}

main().catch(async (err) => {
  logger.error(
    TAG,
    `scan-recommendation-candidates 실패: ${err instanceof Error ? err.message : String(err)}`,
  );
  await pool.end();
  process.exit(1);
});
