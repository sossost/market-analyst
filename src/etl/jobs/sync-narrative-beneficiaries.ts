/**
 * sync-narrative-beneficiaries.ts — narrative_chains beneficiary_tickers 주기적 동기화.
 *
 * ACTIVE/RESOLVING chain의 beneficiary_tickers를 현재 stock_phases와 대조하여:
 * 1. Phase 1/4로 전환된 종목 → 배열에서 제거
 * 2. 빈 chain(beneficiary_tickers 0개) + beneficiary_sectors 존재 → Phase 2 + RS >= 60 자동 후보 추가
 *
 * scan-thesis-aligned-candidates 이전에 실행하여 upstream 데이터 품질을 보장한다.
 *
 * Issue #842
 */

import "dotenv/config";
import { pool, db } from "@/db/client";
import { narrativeChains, stockPhases } from "@/db/schema/analyst";
import { symbols, symbolIndustryOverrides } from "@/db/schema/market";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { logger } from "@/lib/logger";
import { inArray, eq, and, sql } from "drizzle-orm";
import type { NarrativeChainStatus } from "@/db/schema/analyst";

const TAG = "SYNC_NARRATIVE_BENEFICIARIES";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
const PHASE_1 = 1;
const PHASE_2 = 2;
const PHASE_4 = 4;
const RS_THRESHOLD = 60;
/** 빈 chain 자동 후보 추가 상한 */
const MAX_AUTO_CANDIDATES = 5;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface PhaseInfo {
  phase: number;
  rsScore: number | null;
}

interface ChainRow {
  id: number;
  megatrend: string;
  bottleneck: string;
  beneficiaryTickers: string[];
  beneficiarySectors: string[];
}

export interface SyncResult {
  chainsProcessed: number;
  tickersRemoved: number;
  tickersAdded: number;
  chainsUpdated: number;
}

// ─── 순수 함수 (테스트 가능) ───────────────────────────────────────────────────

/**
 * beneficiary_tickers에서 Phase 1/4로 전환된 종목을 분류한다.
 *
 * stock_phases 데이터가 없는 종목은 유지한다 (데이터 갭 허용).
 */
export function filterDegradedTickers(
  tickers: string[],
  phaseMap: Map<string, PhaseInfo>,
): { kept: string[]; removed: string[] } {
  const kept: string[] = [];
  const removed: string[] = [];

  for (const ticker of tickers) {
    const info = phaseMap.get(ticker);
    if (info == null) {
      // stock_phases 데이터 없음 → 유지 (신규 상장, 데이터 갭 등)
      kept.push(ticker);
      continue;
    }

    if (info.phase === PHASE_1 || info.phase === PHASE_4) {
      removed.push(ticker);
    } else {
      kept.push(ticker);
    }
  }

  return { kept, removed };
}

/**
 * 빈 chain의 beneficiary_sectors에서 Phase 2 + RS >= 60 후보를 선별한다.
 *
 * RS 내림차순 정렬 후 상한(MAX_AUTO_CANDIDATES)만큼 반환.
 */
export function selectAutoDiscoveryCandidates(
  sectorCandidates: Array<{ symbol: string; rsScore: number | null }>,
  maxCandidates: number = MAX_AUTO_CANDIDATES,
): string[] {
  return [...sectorCandidates]
    .sort((a, b) => (b.rsScore ?? 0) - (a.rsScore ?? 0))
    .slice(0, maxCandidates)
    .map((c) => c.symbol);
}

// ─── DB 조회 ──────────────────────────────────────────────────────────────────

/**
 * ACTIVE/RESOLVING chain을 조회한다.
 * beneficiary 데이터 없는 chain은 동기화 루프에서 warn 로그 후 스킵.
 */
async function fetchActiveChains(): Promise<ChainRow[]> {
  const rows = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
      beneficiaryTickers: narrativeChains.beneficiaryTickers,
      beneficiarySectors: narrativeChains.beneficiarySectors,
    })
    .from(narrativeChains)
    .where(inArray(narrativeChains.status, ACTIVE_STATUSES));

  return rows.map((r) => ({
    id: r.id,
    megatrend: r.megatrend,
    bottleneck: r.bottleneck,
    beneficiaryTickers: Array.isArray(r.beneficiaryTickers)
      ? (r.beneficiaryTickers as string[]).filter(
          (t) => typeof t === "string" && t !== "",
        )
      : [],
    beneficiarySectors: Array.isArray(r.beneficiarySectors)
      ? (r.beneficiarySectors as string[]).filter(
          (s) => typeof s === "string" && s !== "",
        )
      : [],
  }));
}

/**
 * 지정 종목들의 현재 Phase/RS를 조회한다.
 */
async function fetchPhaseData(
  tickerList: string[],
  date: string,
): Promise<Map<string, PhaseInfo>> {
  if (tickerList.length === 0) return new Map();

  const rows = await db
    .select({
      symbol: stockPhases.symbol,
      phase: stockPhases.phase,
      rsScore: stockPhases.rsScore,
    })
    .from(stockPhases)
    .where(
      and(inArray(stockPhases.symbol, tickerList), eq(stockPhases.date, date)),
    );

  return new Map(
    rows.map((r) => [r.symbol, { phase: r.phase, rsScore: r.rsScore }]),
  );
}

/**
 * 지정 업종에서 Phase 2 + RS >= 60 종목을 조회한다.
 */
async function discoverSectorCandidates(
  sectors: string[],
  date: string,
): Promise<Array<{ symbol: string; rsScore: number | null }>> {
  if (sectors.length === 0) return [];

  const rows = await db
    .select({
      symbol: stockPhases.symbol,
      rsScore: stockPhases.rsScore,
    })
    .from(stockPhases)
    .innerJoin(symbols, eq(stockPhases.symbol, symbols.symbol))
    .leftJoin(
      symbolIndustryOverrides,
      eq(symbols.symbol, symbolIndustryOverrides.symbol),
    )
    .where(
      and(
        eq(stockPhases.date, date),
        eq(stockPhases.phase, PHASE_2),
        sql`${stockPhases.rsScore} >= ${RS_THRESHOLD}`,
        inArray(
          sql`COALESCE(${symbolIndustryOverrides.industry}, ${symbols.industry})`,
          sectors,
        ),
      ),
    );

  return rows.map((r) => ({
    symbol: r.symbol,
    rsScore: r.rsScore,
  }));
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export async function syncNarrativeBeneficiaries(
  targetDate: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    chainsProcessed: 0,
    tickersRemoved: 0,
    tickersAdded: 0,
    chainsUpdated: 0,
  };

  // 1. ACTIVE/RESOLVING chain 조회
  const chains = await retryDatabaseOperation(() => fetchActiveChains());
  if (chains.length === 0) {
    logger.info(TAG, "ACTIVE/RESOLVING chain 없음. 스킵.");
    return result;
  }

  result.chainsProcessed = chains.length;
  logger.info(TAG, `ACTIVE/RESOLVING chain ${chains.length}개 처리 시작`);

  // 2. 전체 beneficiary_tickers의 Phase/RS 일괄 조회
  const allTickers = [
    ...new Set(chains.flatMap((c) => c.beneficiaryTickers)),
  ];

  const phaseMap = await retryDatabaseOperation(() =>
    fetchPhaseData(allTickers, targetDate),
  );

  // 3. 체인별 동기화
  for (const chain of chains) {
    const hasSectors = chain.beneficiarySectors.length > 0;
    const originalTickers = chain.beneficiaryTickers;

    // 3a. 기존 tickers Phase 1/4 제거
    let finalTickers: string[];
    let removedCount = 0;
    let addedCount = 0;

    if (originalTickers.length > 0) {
      const { kept, removed } = filterDegradedTickers(
        originalTickers,
        phaseMap,
      );
      finalTickers = kept;
      removedCount = removed.length;

      if (removed.length > 0) {
        logger.info(
          TAG,
          `Chain #${chain.id} (${chain.bottleneck}): Phase 1/4 제거 — ${removed.join(", ")}`,
        );
      }
    } else {
      finalTickers = [];
    }

    // 3b. ticker가 비어있고 sectors 존재 → Phase 2 + RS >= 60 자동 후보 추가
    if (finalTickers.length === 0) {
      if (!hasSectors) {
        logger.warn(
          TAG,
          `Chain #${chain.id} (${chain.bottleneck}): beneficiary_tickers/sectors 모두 비어있음 — 자동 추가 불가`,
        );
      } else {
        const candidates = await retryDatabaseOperation(() =>
          discoverSectorCandidates(chain.beneficiarySectors, targetDate),
        );

        if (candidates.length === 0) {
          logger.info(
            TAG,
            `Chain #${chain.id} (${chain.bottleneck}): 업종 기반 Phase 2 + RS >= 60 후보 없음`,
          );
        } else {
          const autoTickers = selectAutoDiscoveryCandidates(candidates);
          finalTickers = autoTickers;
          addedCount = autoTickers.length;

          logger.info(
            TAG,
            `Chain #${chain.id} (${chain.bottleneck}): 업종 기반 자동 추가 — ${autoTickers.join(", ")}`,
          );
        }
      }
    }

    // 3c. 변경 사항이 있을 때만 단일 DB 업데이트
    if (removedCount > 0 || addedCount > 0) {
      await retryDatabaseOperation(() =>
        db
          .update(narrativeChains)
          .set({ beneficiaryTickers: finalTickers })
          .where(eq(narrativeChains.id, chain.id)),
      );
      result.chainsUpdated += 1;
    }

    result.tickersRemoved += removedCount;
    result.tickersAdded += addedCount;
  }

  return result;
}

// ─── 엔트리포인트 ──────────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    logger.info(TAG, "No trade date found. Skipping.");
    await pool.end();
    return;
  }

  logger.info(TAG, `Target date: ${targetDate}`);

  const result = await syncNarrativeBeneficiaries(targetDate);

  logger.info(
    TAG,
    `완료 — 체인 ${result.chainsProcessed}개 처리, ${result.tickersRemoved}개 제거, ${result.tickersAdded}개 추가, ${result.chainsUpdated}개 업데이트`,
  );

  await pool.end();
}

main().catch(async (err) => {
  logger.error(
    TAG,
    `sync-narrative-beneficiaries 실패: ${err instanceof Error ? err.message : String(err)}`,
  );
  await pool.end();
  process.exit(1);
});
