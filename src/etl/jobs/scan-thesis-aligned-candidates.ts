/**
 * scan-thesis-aligned-candidates.ts — thesis 수혜주 자동 등록 ETL.
 *
 * ACTIVE/RESOLVING narrative_chains의 beneficiaryTickers 중
 * Phase 2 진입 종목을 tracked_stocks에 source='thesis_aligned'로 자동 등록.
 * LLM 인증(certifyThesisAligned) 통과 시 tier='featured'.
 *
 * Issue #773 — tracked_stocks 통합 ETL Phase 2
 */

import "dotenv/config";
import { pool } from "@/db/client";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { logger } from "@/lib/logger";
import {
  buildThesisAlignedCandidates,
  PHASE_2,
} from "@/lib/thesisAlignedCandidates.js";
import {
  certifyThesisAlignedCandidates,
} from "@/lib/certifyThesisAligned.js";
import {
  findActiveTrackedStocksBySymbols,
  insertTrackedStock,
} from "@/db/repositories/trackedStocksRepository.js";
import { findLatestClose } from "@/db/repositories/priceRepository.js";
import { findPhase2SinceDates } from "@/db/repositories/stockPhaseRepository.js";
import { fireCorporateAnalyst } from "@/corporate-analyst/runCorporateAnalyst.js";
import { toNum } from "@/etl/utils/common";

const TAG = "SCAN_THESIS_ALIGNED_CANDIDATES";

// ─── 순수 함수 ────────────────────────────────────────────────────────────────

/**
 * thesis_aligned 후보의 tier를 판정한다.
 * LLM 인증(certified=true)이면 featured, 아니면 standard.
 */
export function determineTier(
  certified: boolean | undefined,
): "featured" | "standard" {
  return certified === true ? "featured" : "standard";
}

/**
 * entry_date 기준 90일 후 날짜를 계산한다.
 */
export function calcTrackingEndDate(entryDate: string): string {
  const d = new Date(`${entryDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString().slice(0, 10);
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  // 1. ACTIVE/RESOLVING chain의 수혜주 후보 수집
  const candidateData = await buildThesisAlignedCandidates(targetDate);

  if (candidateData.chains.length === 0) {
    logger.info(TAG, "ACTIVE/RESOLVING chain 없음. 스킵.");
    await pool.end();
    return;
  }

  logger.info(
    TAG,
    `체인 ${candidateData.chains.length}개, 총 후보 ${candidateData.totalCandidates}개, Phase 2 ${candidateData.phase2Count}개`,
  );

  // 2. Phase 2 종목만 필터
  const phase2Chains = candidateData.chains.map((chain) => ({
    ...chain,
    candidates: chain.candidates.filter((c) => c.phase === PHASE_2),
  })).filter((chain) => chain.candidates.length > 0);

  if (phase2Chains.length === 0) {
    logger.info(TAG, "Phase 2 수혜주 없음. 스킵.");
    await pool.end();
    return;
  }

  const phase2Symbols = phase2Chains.flatMap((c) => c.candidates.map((p) => p.symbol));
  const uniquePhase2Symbols = [...new Set(phase2Symbols)];
  logger.info(TAG, `Phase 2 수혜주 ${uniquePhase2Symbols.length}개 (고유)`);

  // 3. 이미 ACTIVE로 존재하는 종목 제외
  const existingRows = await retryDatabaseOperation(() =>
    findActiveTrackedStocksBySymbols(uniquePhase2Symbols),
  );
  const existingSymbols = new Set(existingRows.map((r) => r.symbol));

  const filteredChains = phase2Chains.map((chain) => ({
    ...chain,
    candidates: chain.candidates.filter((c) => !existingSymbols.has(c.symbol)),
  })).filter((chain) => chain.candidates.length > 0);

  const newCandidateCount = filteredChains.reduce((sum, c) => sum + c.candidates.length, 0);

  if (newCandidateCount === 0) {
    logger.info(TAG, "모든 수혜주 이미 ACTIVE 등록됨. 스킵.");
    await pool.end();
    return;
  }

  logger.info(TAG, `신규 등록 대상 ${newCandidateCount}개`);

  // 4. LLM 인증 — certifyThesisAlignedCandidates는 ThesisAlignedData 형태 필요
  const dataForCert = {
    chains: filteredChains,
    totalCandidates: newCandidateCount,
    phase2Count: newCandidateCount,
  };

  let certifiedData = dataForCert;
  try {
    certifiedData = await certifyThesisAlignedCandidates(dataForCert);
    logger.info(
      TAG,
      `LLM 인증 완료 — 인증된 후보 ${certifiedData.totalCandidates}개`,
    );
  } catch (err) {
    logger.warn(
      TAG,
      `LLM 인증 실패 — 전체 미인증(standard) 처리: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 5. 전체 신규 후보 종목의 진입가(종가) 일괄 조회
  const allNewSymbols = certifiedData.chains.flatMap((c) => c.candidates.map((p) => p.symbol));
  const uniqueNewSymbols = [...new Set(allNewSymbols)];

  const [priceRows, phase2SinceRows] = await Promise.all([
    retryDatabaseOperation(() => findLatestClose(uniqueNewSymbols, targetDate)),
    retryDatabaseOperation(() => findPhase2SinceDates(uniqueNewSymbols, targetDate)),
  ]);
  const priceMap = new Map(priceRows.map((r) => [r.symbol, toNum(r.close)]));
  const phase2SinceMap = new Map(phase2SinceRows.map((r) => [r.symbol, r.phase2_since]));

  // 6. INSERT — thesis_aligned
  let savedCount = 0;
  let skippedCount = 0;
  const corporateAnalystPromises: Promise<void>[] = [];

  for (const chain of certifiedData.chains) {
    for (const candidate of chain.candidates) {
      const tier = determineTier(candidate.certified);
      const trackingEndDate = calcTrackingEndDate(targetDate);

      // narrativeChain의 chainId를 entry_thesis_id로 사용 (linked_thesis_ids 브릿지)
      const entryThesisId = chain.chainId;

      // 종가 없으면 스킵 (entry_price NOT NULL 제약)
      const entryPrice = priceMap.get(candidate.symbol) ?? null;
      if (entryPrice == null || entryPrice === 0) {
        logger.info(TAG, `${candidate.symbol}: 종가 없음 — 스킵`);
        skippedCount++;
        continue;
      }

      const insertedId = await retryDatabaseOperation(() =>
        insertTrackedStock({
          symbol: candidate.symbol,
          source: "thesis_aligned",
          tier,
          entryDate: targetDate,
          entryPrice,
          entryPhase: candidate.phase ?? PHASE_2,
          entryPrevPhase: null,
          entryRsScore: candidate.rsScore,
          entrySepaGrade: candidate.sepaGrade,
          entryThesisId,
          entrySector: candidate.sector,
          entryIndustry: candidate.industry,
          entryReason: `[thesis_aligned] ${chain.megatrend} — ${chain.bottleneck}`,
          phase2Since: phase2SinceMap.get(candidate.symbol) ?? null,
          marketRegime: null,
          trackingEndDate,
          currentPhase: candidate.phase ?? PHASE_2,
          currentPrice: entryPrice,
          currentRsScore: candidate.rsScore,
        }),
      );

      if (insertedId == null) {
        skippedCount++;
        logger.info(TAG, `${candidate.symbol}: 이미 등록됨 (UNIQUE 충돌)`);
      } else {
        savedCount++;
        logger.info(
          TAG,
          `${candidate.symbol}: 등록 완료 (tier=${tier}, chain=${chain.bottleneck})`,
        );

        // 기업 분석 리포트 — featured tier 종목만 생성 (#847)
        if (tier === "featured") {
          corporateAnalystPromises.push(
            fireCorporateAnalyst(candidate.symbol, targetDate, pool, TAG),
          );
        }
      }
    }
  }

  if (corporateAnalystPromises.length > 0) {
    logger.info(TAG, `CorporateAnalyst ${corporateAnalystPromises.length}건 대기 중...`);
    await Promise.allSettled(corporateAnalystPromises);
  }

  logger.info(
    TAG,
    `완료 — 저장: ${savedCount}, 스킵: ${skippedCount}`,
  );

  await pool.end();
}

main().catch(async (err) => {
  logger.error(
    TAG,
    `scan-thesis-aligned-candidates 실패: ${err instanceof Error ? err.message : String(err)}`,
  );
  await pool.end();
  process.exit(1);
});
