/**
 * thesisAlignedCandidates.ts — ACTIVE thesis 수혜주 기술적 상태 조인
 *
 * 두 가지 경로로 후보를 수집한다:
 * 1. LLM 지목: narrative_chains.beneficiary_tickers에 직접 기록된 종목
 * 2. 업종 자동 탐색: beneficiary_sectors에 해당하는 업종에서 Phase 2 + RS >= 60 종목
 *
 * 게이트 간이 판정: Phase 2 + RS >= 60 + SEPA S/A + thesis 연결(항상 1) = 최대 4/5
 * (업종 RS 게이트는 미포함 — 향후 추가 가능)
 */

import { db } from "@/db/client";
import {
  narrativeChains,
  stockPhases,
  type NarrativeChainStatus,
} from "@/db/schema/analyst";
import { symbols, symbolIndustryOverrides } from "@/db/schema/market";
import { inArray, eq, and, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export interface ThesisAlignedCandidate {
  symbol: string;
  chainId: number;
  megatrend: string;
  bottleneck: string;
  chainStatus: NarrativeChainStatus;
  phase: number | null;
  rsScore: number | null;
  pctFromHigh52w: number | null;
  sepaGrade: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  /** 관심종목 등록 게이트 충족 수 (업종 RS 미포함, 최대 4) */
  gatePassCount: number;
  /** 게이트 총 개수 (업종 RS 미포함 = 4) */
  gateTotalCount: number;
  /** "llm" = LLM이 직접 지목, "sector" = 업종 자동 탐색 */
  source: "llm" | "sector";
  /** LLM 인증 여부 (인증 단계 미실행 시 undefined) */
  certified?: boolean;
  /**
   * LLM이 생성한 인증/미인증 사유 (디버깅용).
   * UNTRUSTED — 서드파티 데이터(company description)에 영향받은 LLM 출력.
   * HTML 렌더링 시 반드시 escapeHtml() 처리 필요.
   */
  certificationReason?: string;
}

export interface ThesisAlignedChainGroup {
  chainId: number;
  megatrend: string;
  bottleneck: string;
  chainStatus: NarrativeChainStatus;
  alphaCompatible: boolean | null;
  daysSinceIdentified: number;
  candidates: ThesisAlignedCandidate[];
}

export interface ThesisAlignedData {
  chains: ThesisAlignedChainGroup[];
  totalCandidates: number;
  phase2Count: number;
}

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: NarrativeChainStatus[] = ["ACTIVE", "RESOLVING"];
const PHASE_2 = 2;
const RS_THRESHOLD = 60;
const SEPA_TOP_GRADES = ["S", "A"];
/** 업종 자동 탐색 후보 상한 (체인당) — LLM 지목은 제한 없음 */
const MAX_SECTOR_CANDIDATES_PER_CHAIN = 10;
/** 게이트 총 개수 — 업종 RS 미포함 */
const GATE_TOTAL_COUNT = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── 게이트 판정 ───────────────────────────────────────────────────────────────

export function countGatePasses(
  phase: number | null,
  rsScore: number | null,
  sepaGrade: string | null,
): number {
  let count = 0;

  // Gate 1: Phase 2
  if (phase === PHASE_2) count += 1;

  // Gate 2: RS >= 60
  if (rsScore != null && rsScore >= RS_THRESHOLD) count += 1;

  // Gate 3: SEPA S 또는 A
  if (sepaGrade != null && SEPA_TOP_GRADES.includes(sepaGrade)) count += 1;

  // Gate 4: thesis 연결 — chain에서 왔으므로 항상 충족
  count += 1;

  return count;
}

// ─── 메인 함수 ──────────────────────────────────────────────────────────────────

/**
 * ACTIVE/RESOLVING chain의 수혜주를 기술적 데이터와 조인하여 반환한다.
 *
 * 후보 수집 경로:
 * 1. beneficiary_tickers (LLM 지목) — chain에 직접 기록된 종목
 * 2. beneficiary_sectors (업종 자동 탐색) — 해당 업종에서 Phase 2 + RS >= 60 종목
 *
 * beneficiary_tickers/sectors 모두 빈 배열인 chain은 자동 제외.
 */
export async function buildThesisAlignedCandidates(
  date: string,
): Promise<ThesisAlignedData> {
  // 1. ACTIVE/RESOLVING chain 조회 (beneficiary_tickers 또는 beneficiary_sectors 비어있지 않음)
  const activeChains = await db
    .select({
      id: narrativeChains.id,
      megatrend: narrativeChains.megatrend,
      bottleneck: narrativeChains.bottleneck,
      status: narrativeChains.status,
      alphaCompatible: narrativeChains.alphaCompatible,
      bottleneckIdentifiedAt: narrativeChains.bottleneckIdentifiedAt,
      beneficiaryTickers: narrativeChains.beneficiaryTickers,
      beneficiarySectors: narrativeChains.beneficiarySectors,
    })
    .from(narrativeChains)
    .where(
      and(
        inArray(narrativeChains.status, ACTIVE_STATUSES),
        sql`(jsonb_array_length(${narrativeChains.beneficiaryTickers}) > 0 OR jsonb_array_length(${narrativeChains.beneficiarySectors}) > 0)`,
      ),
    );

  if (activeChains.length === 0) {
    return { chains: [], totalCandidates: 0, phase2Count: 0 };
  }

  // 2. 두 경로에서 종목 수집
  // 경로 1: LLM 지목 (beneficiary_tickers)
  const llmTickers = new Set<string>();
  for (const chain of activeChains) {
    const tickers = chain.beneficiaryTickers;
    if (Array.isArray(tickers)) {
      for (const t of tickers) {
        if (typeof t === "string" && t !== "") {
          llmTickers.add(t);
        }
      }
    }
  }

  // 경로 2: 업종 자동 탐색 (beneficiary_sectors에서 Phase 2 + RS >= 60 종목)
  const allSectors = new Set<string>();
  for (const chain of activeChains) {
    const sectors = chain.beneficiarySectors;
    if (Array.isArray(sectors)) {
      for (const s of sectors) {
        if (typeof s === "string" && s !== "") {
          allSectors.add(s);
        }
      }
    }
  }

  const sectorList = Array.from(allSectors);

  // 업종에서 Phase 2 + RS >= 60 종목 조회
  const sectorDiscovered = new Map<string, { symbol: string; industry: string }>();
  if (sectorList.length > 0) {
    const sectorRows = await db
      .select({
        symbol: stockPhases.symbol,
        phase: stockPhases.phase,
        rsScore: stockPhases.rsScore,
        industry: sql<string>`COALESCE(${symbolIndustryOverrides.industry}, ${symbols.industry})`.as("industry"),
      })
      .from(stockPhases)
      .innerJoin(symbols, eq(stockPhases.symbol, symbols.symbol))
      .leftJoin(symbolIndustryOverrides, eq(symbols.symbol, symbolIndustryOverrides.symbol))
      .where(
        and(
          eq(stockPhases.date, date),
          eq(stockPhases.phase, PHASE_2),
          sql`${stockPhases.rsScore} >= ${RS_THRESHOLD}`,
          sql`COALESCE(${symbolIndustryOverrides.industry}, ${symbols.industry}) = ANY(${sectorList})`,
        ),
      );

    for (const row of sectorRows) {
      if (!llmTickers.has(row.symbol)) {
        sectorDiscovered.set(row.symbol, {
          symbol: row.symbol,
          industry: row.industry ?? "",
        });
      }
    }
  }

  // 전체 종목 목록 (LLM + 업종 자동 탐색, 중복 제거)
  const allTickers = new Set([...llmTickers, ...sectorDiscovered.keys()]);
  const tickerList = Array.from(allTickers);

  if (tickerList.length === 0) {
    return { chains: [], totalCandidates: 0, phase2Count: 0 };
  }

  // 3. 병렬 DB 조회: stock_phases + fundamental_scores + symbols
  const [phaseRows, sepaRows, profileRows] = await Promise.all([
    // stock_phases: 해당 날짜의 Phase, RS, 52w 고점 대비
    db
      .select({
        symbol: stockPhases.symbol,
        phase: stockPhases.phase,
        rsScore: stockPhases.rsScore,
        pctFromHigh52w: stockPhases.pctFromHigh52w,
      })
      .from(stockPhases)
      .where(
        and(
          inArray(stockPhases.symbol, tickerList),
          eq(stockPhases.date, date),
        ),
      ),

    // fundamental_scores: 최신 SEPA 등급 (PostgreSQL DISTINCT ON)
    db.execute(sql`
      SELECT DISTINCT ON (symbol) symbol, grade
      FROM fundamental_scores
      WHERE symbol IN (${sql.join(tickerList.map((t) => sql`${t}`), sql`, `)})
        AND scored_date <= ${date}
      ORDER BY symbol, scored_date DESC
    `).then((result) =>
      (result.rows as unknown as { symbol: string; grade: string }[]),
    ),

    // symbols: sector, industry, market_cap (전체 종목 프로필)
    db
      .select({
        symbol: symbols.symbol,
        sector: symbols.sector,
        industry: sql<string>`COALESCE(${symbolIndustryOverrides.industry}, ${symbols.industry})`.as("industry"),
        marketCap: symbols.marketCap,
      })
      .from(symbols)
      .leftJoin(symbolIndustryOverrides, eq(symbols.symbol, symbolIndustryOverrides.symbol))
      .where(inArray(symbols.symbol, tickerList)),
  ]);

  // 4. 룩업 맵 생성
  const phaseMap = new Map(
    phaseRows.map((r) => [
      r.symbol,
      {
        phase: r.phase,
        rsScore: r.rsScore,
        pctFromHigh52w: r.pctFromHigh52w != null ? Number(r.pctFromHigh52w) : null,
      },
    ]),
  );

  const sepaMap = new Map(sepaRows.map((r) => [r.symbol, r.grade]));

  const profileMap = new Map(
    profileRows.map((r) => [
      r.symbol,
      {
        sector: r.sector,
        industry: r.industry,
        marketCap: r.marketCap != null ? Number(r.marketCap) : null,
      },
    ]),
  );

  // 5. 체인별 그룹 생성
  const now = new Date();

  // chain별로 어떤 업종을 갖고 있는지 매핑
  const chainSectorsMap = new Map<number, Set<string>>();
  for (const chain of activeChains) {
    const sectors = chain.beneficiarySectors;
    if (Array.isArray(sectors)) {
      chainSectorsMap.set(chain.id, new Set(sectors.filter((s): s is string => typeof s === "string" && s !== "")));
    }
  }

  const chains: ThesisAlignedChainGroup[] = activeChains.map((chain) => {
    const tickers = (chain.beneficiaryTickers as string[]) ?? [];
    const identifiedAt = chain.bottleneckIdentifiedAt;
    const daysSinceIdentified =
      identifiedAt != null
        ? Math.round((now.getTime() - identifiedAt.getTime()) / MS_PER_DAY)
        : 0;

    const chainSectors = chainSectorsMap.get(chain.id) ?? new Set<string>();

    // LLM 지목 종목
    const llmCandidates: ThesisAlignedCandidate[] = tickers
      .filter((t) => typeof t === "string" && t !== "")
      .map((symbol) => buildCandidate(symbol, chain, "llm", phaseMap, sepaMap, profileMap));

    // 업종 자동 탐색 종목 (이 chain의 beneficiary_sectors에 해당하고 LLM 지목에 없는 것)
    const llmSymbolSet = new Set(tickers);
    const sectorCandidates: ThesisAlignedCandidate[] = [];
    for (const [symbol, info] of sectorDiscovered) {
      if (!llmSymbolSet.has(symbol) && chainSectors.has(info.industry)) {
        sectorCandidates.push(
          buildCandidate(symbol, chain, "sector", phaseMap, sepaMap, profileMap),
        );
      }
    }

    // 업종 탐색 후보는 RS 상위 N개로 제한 (LLM 지목은 전부 포함)
    sectorCandidates.sort((a, b) => (b.rsScore ?? 0) - (a.rsScore ?? 0));
    const topSectorCandidates = sectorCandidates.slice(0, MAX_SECTOR_CANDIDATES_PER_CHAIN);

    // SEPA 등급 없는 종목 제외 (LLM 지목 포함 — 동일 기준 적용)
    const allBeforeFilter = [...llmCandidates, ...topSectorCandidates];
    const droppedLlm = allBeforeFilter.filter((c) => c.source === "llm" && c.sepaGrade == null);
    if (droppedLlm.length > 0) {
      logger.warn(
        "ThesisAligned",
        `SEPA 미등급으로 제외된 LLM 지목 종목: ${droppedLlm.map((c) => c.symbol).join(", ")}`,
      );
    }
    const noSepa = allBeforeFilter.filter((c) => c.sepaGrade == null);
    if (noSepa.length > 0) {
      logger.warn(
        "ThesisAligned",
        `SEPA 없어 제외: ${noSepa.map((c) => c.symbol).join(", ")}`,
      );
    }
    // 같은 종목이 여러 체인에 중복 등장할 수 있음 (의도된 동작 — 체인별 독립 평가)
    const candidates = allBeforeFilter.filter((c) => c.sepaGrade != null);

    // SEPA 등급순 (S→A→B→C→F), 같은 등급 내 RS 내림차순
    const SEPA_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, F: 4 };
    const SEPA_DEFAULT = 5;
    candidates.sort((a, b) => {
      const gradeA = SEPA_ORDER[a.sepaGrade ?? ""] ?? SEPA_DEFAULT;
      const gradeB = SEPA_ORDER[b.sepaGrade ?? ""] ?? SEPA_DEFAULT;
      if (gradeA !== gradeB) return gradeA - gradeB;
      return (b.rsScore ?? 0) - (a.rsScore ?? 0);
    });

    return {
      chainId: chain.id,
      megatrend: chain.megatrend,
      bottleneck: chain.bottleneck,
      chainStatus: chain.status as NarrativeChainStatus,
      alphaCompatible: chain.alphaCompatible,
      daysSinceIdentified,
      candidates,
    };
  });

  // 후보가 0인 chain 제거
  const nonEmptyChains = chains.filter((c) => c.candidates.length > 0);

  // totalCandidates: 전체 체인에 걸친 총 후보 수 (동일 종목이 여러 체인에 있으면 중복 카운트)
  const totalCandidates = nonEmptyChains.reduce((sum, c) => sum + c.candidates.length, 0);

  // phase2Count: 고유 심볼 기준 Phase 2 종목 수 (이중 카운트 방지)
  const phase2Symbols = new Set<string>();
  for (const chain of nonEmptyChains) {
    for (const c of chain.candidates) {
      if (c.phase === PHASE_2) {
        phase2Symbols.add(c.symbol);
      }
    }
  }
  const phase2Count = phase2Symbols.size;

  logger.info(
    "ThesisAligned",
    `체인 ${nonEmptyChains.length}개, 총 후보 ${totalCandidates}개, Phase 2 ${phase2Count}개`,
  );

  return { chains: nonEmptyChains, totalCandidates, phase2Count };
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function buildCandidate(
  symbol: string,
  chain: { id: number; megatrend: string; bottleneck: string; status: string },
  source: "llm" | "sector",
  phaseMap: Map<string, { phase: number; rsScore: number | null; pctFromHigh52w: number | null }>,
  sepaMap: Map<string, string>,
  profileMap: Map<string, { sector: string | null; industry: string | null; marketCap: number | null }>,
): ThesisAlignedCandidate {
  const phaseData = phaseMap.get(symbol);
  const sepaGrade = sepaMap.get(symbol) ?? null;
  const profile = profileMap.get(symbol);

  const phase = phaseData?.phase ?? null;
  const rsScore = phaseData?.rsScore ?? null;
  const pctFromHigh52w = phaseData?.pctFromHigh52w ?? null;

  return {
    symbol,
    chainId: chain.id,
    megatrend: chain.megatrend,
    bottleneck: chain.bottleneck,
    chainStatus: chain.status as NarrativeChainStatus,
    phase,
    rsScore,
    pctFromHigh52w,
    sepaGrade,
    sector: profile?.sector ?? null,
    industry: profile?.industry ?? null,
    marketCap: profile?.marketCap ?? null,
    gatePassCount: countGatePasses(phase, rsScore, sepaGrade),
    gateTotalCount: GATE_TOTAL_COUNT,
    source,
  };
}
