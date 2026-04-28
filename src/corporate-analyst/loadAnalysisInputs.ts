/**
 * 기업 애널리스트 에이전트를 위한 종목별 분석 입력 데이터 로더.
 *
 * 기술적 팩터, 섹터 RS, 4분기 실적, 밸류에이션, 시장 레짐, 토론 synthesis 외
 * Phase B 신규 데이터(기업 프로필, 연간 재무, 어닝콜, 애널리스트 추정치, EPS 서프라이즈,
 * 피어 그룹 밸류에이션, 가격 목표 컨센서스)를 Promise.all로 병렬 조회하여
 * LLM 프롬프트에 주입할 구조화 데이터를 반환한다.
 *
 * 데이터 부재 시 graceful degradation: null 필드를 그대로 반환하고
 * 상위 레이어(corporateAnalyst)에서 섹션별 fallback 텍스트를 생성한다.
 */
import type { Pool } from "pg";
import { logger } from "@/lib/logger";
import {
  findRecommendationFactors,
  findSymbolInfo,
  findQuarterlyFinancials,
  findQuarterlyRatios,
  findMarketRegimeByDate,
  findDebateSessionByDateRange,
  findCompanyProfile,
  findAnnualFinancials,
  findEarningCallTranscript,
  findAnalystEstimates,
  findEpsSurprises,
  findPeerGroup,
  findPriceTargetConsensus,
  findCurrentPrice,
  findSectorRsByDate,
  findIndustryRsByDate,
  findPeerRatios,
  findStockNews,
  findUpcomingEarnings,
} from "@/db/repositories/index.js";

/** 최근 토론 synthesis를 사용하는 최대 일수 */
const DEBATE_LOOKBACK_DAYS = 7;

/** 토큰 초과 방지를 위한 debateSynthesis 최대 글자 수 */
const MAX_SYNTHESIS_CHARS = 2_000;

/** 조회할 최근 분기 실적 수 */
const FINANCIALS_QUARTERS = 4;

/** 연간 재무제표 조회 연도 수 */
const ANNUAL_FINANCIALS_YEARS = 3;

/** 토큰 초과 방지를 위한 earningsTranscript 최대 글자 수 */
const MAX_TRANSCRIPT_CHARS = 3_000;

/** 조회할 애널리스트 추정치 분기 수 */
const ANALYST_ESTIMATES_QUARTERS = 4;

/** 조회할 EPS 서프라이즈 분기 수 */
const EPS_SURPRISES_QUARTERS = 4;

/** 조회할 최근 뉴스 건수 */
const RECENT_NEWS_LIMIT = 5;

export interface AnalysisInputs {
  /** 기술적 데이터 (recommendation_factors) */
  technical: {
    rsScore: number | null;
    phase: number | null;
    ma150Slope: number | null;
    volRatio: number | null;
    pctFromHigh52w: number | null;
    pctFromLow52w: number | null;
    conditionsMet: string | null;
    volumeConfirmed: boolean | null;
  };

  /** 섹터·업종 RS (sector_rs_daily + industry_rs_daily) */
  sectorContext: {
    sector: string | null;
    industry: string | null;
    sectorRs: number | null;
    sectorGroupPhase: number | null;
    industryRs: number | null;
    industryGroupPhase: number | null;
    sectorChange4w: number | null;
    sectorChange8w: number | null;
  };

  /** 4분기 실적 (quarterly_financials, 최근 4행) */
  financials: Array<{
    periodEndDate: string;
    revenue: number | null;
    netIncome: number | null;
    epsDiluted: number | null;
    ebitda: number | null;
    freeCashFlow: number | null;
    grossProfit: number | null;
  }>;

  /** 밸류에이션 멀티플 (quarterly_ratios, 최근 1행) */
  ratios: {
    peRatio: number | null;
    psRatio: number | null;
    pbRatio: number | null;
    evEbitda: number | null;
    grossMargin: number | null;
    opMargin: number | null;
    netMargin: number | null;
    debtEquity: number | null;
  } | null;

  /** 시장 레짐 (market_regimes, 추천일 기준 최신 confirmed) */
  marketRegime: {
    regime: string;
    rationale: string;
    confidence: string;
  } | null;

  /** 토론 synthesis (debate_sessions, 최근 7일 이내, 2000자 truncate) */
  debateSynthesis: string | null;

  /** 종목 기본 정보 (symbols 테이블) */
  companyName: string | null;
  sector: string | null;
  industry: string | null;

  // ── Phase B 신규 데이터 ────────────────────────────────────────────

  /** 기업 프로필 (company_profiles) */
  companyProfile: {
    description: string | null;
    ceo: string | null;
    employees: number | null;
    marketCap: number | null;
    website: string | null;
    country: string | null;
    exchange: string | null;
    ipoDate: string | null;
  } | null;

  /** 연간 재무제표 최근 3년 (annual_financials, ORDER BY fiscal_year DESC) */
  annualFinancials: Array<{
    fiscalYear: string;
    revenue: number | null;
    netIncome: number | null;
    epsDiluted: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    ebitda: number | null;
    freeCashFlow: number | null;
  }> | null;

  /** 최근 어닝콜 트랜스크립트 (earning_call_transcripts, 3000자 truncate) */
  earningsTranscript: {
    quarter: number;
    year: number;
    date: string | null;
    transcript: string | null;
  } | null;

  /** 애널리스트 EPS/매출 추정치 최근 4분기 (analyst_estimates) */
  analystEstimates: Array<{
    period: string;
    estimatedEpsAvg: number | null;
    estimatedEpsHigh: number | null;
    estimatedEpsLow: number | null;
    estimatedRevenueAvg: number | null;
    numberAnalysts: number | null;
  }> | null;

  /** EPS 서프라이즈 히스토리 최근 4분기 (eps_surprises) */
  epsSurprises: Array<{
    actualDate: string;
    actualEps: number | null;
    estimatedEps: number | null;
  }> | null;

  /** 피어 그룹 + 피어별 최신 밸류에이션 멀티플 (peer_groups + quarterly_ratios) */
  peerGroup: Array<{
    symbol: string;
    peRatio: number | null;
    evEbitda: number | null;
    psRatio: number | null;
  }> | null;

  /** 월가 가격 목표 컨센서스 (price_target_consensus) */
  priceTargetConsensus: {
    targetHigh: number | null;
    targetLow: number | null;
    targetMean: number | null;
    targetMedian: number | null;
  } | null;

  /** Phase C: 정량 모델 입력용 현재가 (daily_prices.close, recommendationDate 이하 최신) */
  currentPrice: number | null;

  /** 최근 뉴스 5건 (stock_news) — title + site + publishedDate */
  recentNews: Array<{
    title: string | null;
    site: string | null;
    publishedDate: string | null;
  }> | null;

  /** 30일 이내 실적 발표 일정 (earning_calendar) */
  upcomingEarnings: Array<{
    date: string;
    epsEstimated: number | null;
    revenueEstimated: number | null;
    time: string | null;
  }> | null;
}

// ---------------------------------------------------------------------------
// 내부 DB 행 타입
// ---------------------------------------------------------------------------

interface RecommendationFactorsRow {
  rs_score: number | null;
  phase: number | null;
  ma150_slope: string | null;
  vol_ratio: string | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
  volume_confirmed: boolean | null;
  sector_rs: string | null;
  sector_group_phase: number | null;
  industry_rs: string | null;
  industry_group_phase: number | null;
}

interface SymbolRow {
  company_name: string | null;
  sector: string | null;
  industry: string | null;
}

interface SectorRsRow {
  avg_rs: string | null;
  group_phase: number | null;
  change_4w: string | null;
  change_8w: string | null;
}

interface IndustryRsRow {
  avg_rs: string | null;
  group_phase: number | null;
}

interface FinancialsRow {
  period_end_date: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  ebitda: string | null;
  free_cash_flow: string | null;
  gross_profit: string | null;
}

interface RatiosRow {
  pe_ratio: string | null;
  ps_ratio: string | null;
  pb_ratio: string | null;
  ev_ebitda: string | null;
  gross_margin: string | null;
  op_margin: string | null;
  net_margin: string | null;
  debt_equity: string | null;
}

interface MarketRegimeRow {
  regime: string;
  rationale: string;
  confidence: string;
}

interface DebateSessionRow {
  synthesis_report: string;
}

interface CompanyProfileRow {
  description: string | null;
  ceo: string | null;
  employees: number | null;
  market_cap: string | null;
  website: string | null;
  country: string | null;
  exchange: string | null;
  ipo_date: string | null;
}

interface AnnualFinancialsRow {
  fiscal_year: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  gross_profit: string | null;
  operating_income: string | null;
  ebitda: string | null;
  free_cash_flow: string | null;
}

interface EarningCallTranscriptRow {
  quarter: number;
  year: number;
  date: string | null;
  transcript: string | null;
}

interface AnalystEstimatesRow {
  period: string;
  estimated_eps_avg: string | null;
  estimated_eps_high: string | null;
  estimated_eps_low: string | null;
  estimated_revenue_avg: string | null;
  number_analyst_estimated_eps: number | null;
}

interface EpsSurprisesRow {
  actual_date: string;
  actual_eps: string | null;
  estimated_eps: string | null;
}

interface PeerGroupRow {
  peers: string[] | null;
}

interface PeerRatiosRow {
  symbol: string;
  pe_ratio: string | null;
  ev_ebitda: string | null;
  ps_ratio: string | null;
}

interface PriceTargetConsensusRow {
  target_high: string | null;
  target_low: string | null;
  target_mean: string | null;
  target_median: string | null;
}

interface DailyPriceCloseRow {
  close: string;
}

interface StockNewsRow {
  title: string | null;
  site: string | null;
  published_date: string | null;
}

interface EarningCalendarRow {
  date: string | Date;
  eps_estimated: string | null;
  revenue_estimated: string | null;
  time: string | null;
}

// ---------------------------------------------------------------------------
// 개별 쿼리 함수 (에러 시 null 반환하는 safe wrapper)
// ---------------------------------------------------------------------------

/**
 * unknown 값을 number로 변환한다.
 * 변환 실패 또는 null/undefined 입력 시 null을 반환한다.
 * toNum()과 달리 유효한 값 0을 null로 손실하지 않는다.
 */
function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function safeQuery<T>(
  fn: () => Promise<T[]>,
  context: string,
): Promise<T[] | null> {
  try {
    return await fn();
  } catch (err) {
    logger.warn("loadAnalysisInputs", `쿼리 실패 (${context}): ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 종목별 분석 입력 데이터를 병렬로 수집한다.
 *
 * 각 쿼리는 독립적으로 실행되며, 실패 또는 데이터 부재 시 해당 필드는 null로 반환된다.
 * 상위 레이어에서 null 필드에 대한 fallback 텍스트를 생성해야 한다.
 */
export async function loadAnalysisInputs(
  symbol: string,
  recommendationDate: string,
  pool: Pool,
): Promise<AnalysisInputs> {
  const debateCutoff = getDateOffset(recommendationDate, DEBATE_LOOKBACK_DAYS);

  // Phase 1: 심볼 독립 쿼리 병렬 실행 (16개)
  const [
    factorsRows,
    symbolRows,
    financialsRows,
    ratiosRows,
    regimeRows,
    debateRows,
    companyProfileRows,
    annualFinancialsRows,
    transcriptRows,
    analystEstimatesRows,
    epsSurprisesRows,
    peerGroupRows,
    priceTargetRows,
    currentPriceRows,
    stockNewsRows,
    upcomingEarningsRows,
  ] = await Promise.all([
    safeQuery<RecommendationFactorsRow>(
      () => findRecommendationFactors(symbol, recommendationDate, pool),
      "recommendation_factors",
    ),
    safeQuery<SymbolRow>(
      () => findSymbolInfo(symbol, pool),
      "symbols",
    ),
    safeQuery<FinancialsRow>(
      () => findQuarterlyFinancials(symbol, FINANCIALS_QUARTERS, pool),
      "quarterly_financials",
    ),
    safeQuery<RatiosRow>(
      () => findQuarterlyRatios(symbol, pool),
      "quarterly_ratios",
    ),
    safeQuery<MarketRegimeRow>(
      () => findMarketRegimeByDate(recommendationDate, pool),
      "market_regimes",
    ),
    safeQuery<DebateSessionRow>(
      () => findDebateSessionByDateRange(debateCutoff, recommendationDate, pool),
      "debate_sessions",
    ),
    safeQuery<CompanyProfileRow>(
      () => findCompanyProfile(symbol, pool),
      "company_profiles",
    ),
    safeQuery<AnnualFinancialsRow>(
      () => findAnnualFinancials(symbol, ANNUAL_FINANCIALS_YEARS, pool),
      "annual_financials",
    ),
    safeQuery<EarningCallTranscriptRow>(
      () => findEarningCallTranscript(symbol, pool),
      "earning_call_transcripts",
    ),
    safeQuery<AnalystEstimatesRow>(
      () => findAnalystEstimates(symbol, ANALYST_ESTIMATES_QUARTERS, pool),
      "analyst_estimates",
    ),
    safeQuery<EpsSurprisesRow>(
      () => findEpsSurprises(symbol, EPS_SURPRISES_QUARTERS, pool),
      "eps_surprises",
    ),
    safeQuery<PeerGroupRow>(
      () => findPeerGroup(symbol, pool),
      "peer_groups",
    ),
    safeQuery<PriceTargetConsensusRow>(
      () => findPriceTargetConsensus(symbol, pool),
      "price_target_consensus",
    ),
    safeQuery<DailyPriceCloseRow>(
      () => findCurrentPrice(symbol, recommendationDate, pool),
      "daily_prices (currentPrice)",
    ),
    safeQuery<StockNewsRow>(
      () => findStockNews(symbol, RECENT_NEWS_LIMIT, pool),
      "stock_news",
    ),
    safeQuery<EarningCalendarRow>(
      () => findUpcomingEarnings(symbol, recommendationDate, pool),
      "earning_calendar",
    ),
  ]);

  // 기본 종목 정보 추출
  const symbolRow = symbolRows != null && symbolRows.length > 0 ? symbolRows[0] : null;
  const companyName = symbolRow?.company_name ?? null;
  const sector = symbolRow?.sector ?? null;
  const industry = symbolRow?.industry ?? null;

  // Phase 2: 섹터·업종 RS — symbolRow 의존이므로 직렬 처리
  let sectorRow: SectorRsRow | null = null;
  let industryRow: IndustryRsRow | null = null;

  if (sector != null || industry != null) {
    const [sectorRows, industryRowsResult] = await Promise.all([
      sector != null
        ? safeQuery<SectorRsRow>(
            () => findSectorRsByDate(sector, recommendationDate, pool),
            "sector_rs_daily",
          )
        : Promise.resolve(null),
      industry != null
        ? safeQuery<IndustryRsRow>(
            () => findIndustryRsByDate(industry, recommendationDate, pool),
            "industry_rs_daily",
          )
        : Promise.resolve(null),
    ]);

    sectorRow = sectorRows != null && sectorRows.length > 0 ? sectorRows[0] : null;
    industryRow = industryRowsResult != null && industryRowsResult.length > 0 ? industryRowsResult[0] : null;
  }

  const factorsRow =
    factorsRows != null && factorsRows.length > 0 ? factorsRows[0] : null;

  // financials 조합
  const financials =
    financialsRows != null
      ? financialsRows.map((row) => ({
          periodEndDate: row.period_end_date,
          revenue: toNumOrNull(row.revenue),
          netIncome: toNumOrNull(row.net_income),
          epsDiluted: toNumOrNull(row.eps_diluted),
          ebitda: toNumOrNull(row.ebitda),
          freeCashFlow: toNumOrNull(row.free_cash_flow),
          grossProfit: toNumOrNull(row.gross_profit),
        }))
      : [];

  // ratios 조합: ratiosRows가 null이거나 비어있으면 null
  const rawRatiosRow =
    ratiosRows != null && ratiosRows.length > 0 ? ratiosRows[0] : null;

  const ratios =
    rawRatiosRow == null
      ? null
      : {
          peRatio: toNumOrNull(rawRatiosRow.pe_ratio),
          psRatio: toNumOrNull(rawRatiosRow.ps_ratio),
          pbRatio: toNumOrNull(rawRatiosRow.pb_ratio),
          evEbitda: toNumOrNull(rawRatiosRow.ev_ebitda),
          grossMargin: toNumOrNull(rawRatiosRow.gross_margin),
          opMargin: toNumOrNull(rawRatiosRow.op_margin),
          netMargin: toNumOrNull(rawRatiosRow.net_margin),
          debtEquity: toNumOrNull(rawRatiosRow.debt_equity),
        };

  // market regime 조합
  const rawRegimeRow =
    regimeRows != null && regimeRows.length > 0 ? regimeRows[0] : null;

  const marketRegime =
    rawRegimeRow == null
      ? null
      : {
          regime: rawRegimeRow.regime,
          rationale: rawRegimeRow.rationale,
          confidence: rawRegimeRow.confidence,
        };

  // debate synthesis 조합 (2000자 truncate)
  const rawSynthesisRow =
    debateRows != null && debateRows.length > 0 ? debateRows[0] : null;
  const rawSynthesis = rawSynthesisRow?.synthesis_report ?? null;

  const debateSynthesis =
    rawSynthesis == null
      ? null
      : rawSynthesis.length > MAX_SYNTHESIS_CHARS
        ? `${rawSynthesis.slice(0, MAX_SYNTHESIS_CHARS)}... (이하 생략)`
        : rawSynthesis;

  // ── Phase B 데이터 조합 ────────────────────────────────────────────

  // company_profiles
  const rawProfileRow =
    companyProfileRows != null && companyProfileRows.length > 0
      ? companyProfileRows[0]
      : null;

  const companyProfile =
    rawProfileRow == null
      ? null
      : {
          description: rawProfileRow.description,
          ceo: rawProfileRow.ceo,
          employees: rawProfileRow.employees,
          marketCap: toNumOrNull(rawProfileRow.market_cap),
          website: rawProfileRow.website,
          country: rawProfileRow.country,
          exchange: rawProfileRow.exchange,
          ipoDate: rawProfileRow.ipo_date,
        };

  // annual_financials
  const annualFinancials =
    annualFinancialsRows == null || annualFinancialsRows.length === 0
      ? null
      : annualFinancialsRows.map((row) => ({
          fiscalYear: row.fiscal_year,
          revenue: toNumOrNull(row.revenue),
          netIncome: toNumOrNull(row.net_income),
          epsDiluted: toNumOrNull(row.eps_diluted),
          grossProfit: toNumOrNull(row.gross_profit),
          operatingIncome: toNumOrNull(row.operating_income),
          ebitda: toNumOrNull(row.ebitda),
          freeCashFlow: toNumOrNull(row.free_cash_flow),
        }));

  // earning_call_transcripts (transcript 3000자 truncate)
  const rawTranscriptRow =
    transcriptRows != null && transcriptRows.length > 0 ? transcriptRows[0] : null;

  const earningsTranscript =
    rawTranscriptRow == null
      ? null
      : {
          quarter: rawTranscriptRow.quarter,
          year: rawTranscriptRow.year,
          date: rawTranscriptRow.date,
          transcript: truncateTranscript(rawTranscriptRow.transcript),
        };

  // analyst_estimates
  const analystEstimates =
    analystEstimatesRows == null || analystEstimatesRows.length === 0
      ? null
      : analystEstimatesRows.map((row) => ({
          period: row.period,
          estimatedEpsAvg: toNumOrNull(row.estimated_eps_avg),
          estimatedEpsHigh: toNumOrNull(row.estimated_eps_high),
          estimatedEpsLow: toNumOrNull(row.estimated_eps_low),
          estimatedRevenueAvg: toNumOrNull(row.estimated_revenue_avg),
          numberAnalysts: row.number_analyst_estimated_eps,
        }));

  // eps_surprises
  const epsSurprises =
    epsSurprisesRows == null || epsSurprisesRows.length === 0
      ? null
      : epsSurprisesRows.map((row) => ({
          actualDate: row.actual_date,
          actualEps: toNumOrNull(row.actual_eps),
          estimatedEps: toNumOrNull(row.estimated_eps),
        }));

  // price_target_consensus
  const rawPriceTargetRow =
    priceTargetRows != null && priceTargetRows.length > 0 ? priceTargetRows[0] : null;

  const priceTargetConsensus =
    rawPriceTargetRow == null
      ? null
      : {
          targetHigh: toNumOrNull(rawPriceTargetRow.target_high),
          targetLow: toNumOrNull(rawPriceTargetRow.target_low),
          targetMean: toNumOrNull(rawPriceTargetRow.target_mean),
          targetMedian: toNumOrNull(rawPriceTargetRow.target_median),
        };

  // peer_groups: 피어 목록을 얻은 후 각 피어의 quarterly_ratios 조회
  const peerGroup = await loadPeerGroupMultiples(peerGroupRows, pool);

  // currentPrice: daily_prices 최신 close
  const currentPrice =
    currentPriceRows != null && currentPriceRows.length > 0
      ? toNumOrNull(currentPriceRows[0].close)
      : null;

  // recentNews: stock_news 최근 5건
  const recentNews =
    stockNewsRows == null || stockNewsRows.length === 0
      ? null
      : stockNewsRows.map((row) => ({
          title: row.title,
          site: row.site,
          publishedDate: row.published_date,
        }));

  // upcomingEarnings: earning_calendar 30일 이내
  const upcomingEarnings =
    upcomingEarningsRows == null || upcomingEarningsRows.length === 0
      ? null
      : upcomingEarningsRows.map((row) => ({
          date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
          epsEstimated: toNumOrNull(row.eps_estimated),
          revenueEstimated: toNumOrNull(row.revenue_estimated),
          time: row.time,
        }));

  return {
    technical: {
      rsScore: factorsRow?.rs_score ?? null,
      phase: factorsRow?.phase ?? null,
      ma150Slope: toNumOrNull(factorsRow?.ma150_slope),
      volRatio: toNumOrNull(factorsRow?.vol_ratio),
      pctFromHigh52w: toNumOrNull(factorsRow?.pct_from_high_52w),
      pctFromLow52w: toNumOrNull(factorsRow?.pct_from_low_52w),
      conditionsMet: factorsRow?.conditions_met ?? null,
      volumeConfirmed: factorsRow?.volume_confirmed ?? null,
    },
    sectorContext: {
      sector,
      industry,
      sectorRs:
        sectorRow != null
          ? toNumOrNull(sectorRow.avg_rs)
          : toNumOrNull(factorsRow?.sector_rs),
      sectorGroupPhase: sectorRow?.group_phase ?? factorsRow?.sector_group_phase ?? null,
      industryRs:
        industryRow != null
          ? toNumOrNull(industryRow.avg_rs)
          : toNumOrNull(factorsRow?.industry_rs),
      industryGroupPhase:
        industryRow?.group_phase ?? factorsRow?.industry_group_phase ?? null,
      sectorChange4w: toNumOrNull(sectorRow?.change_4w),
      sectorChange8w: toNumOrNull(sectorRow?.change_8w),
    },
    financials,
    ratios,
    marketRegime,
    debateSynthesis,
    companyName,
    sector,
    industry,
    companyProfile,
    annualFinancials,
    earningsTranscript,
    analystEstimates,
    epsSurprises,
    peerGroup,
    priceTargetConsensus,
    currentPrice,
    recentNews,
    upcomingEarnings,
  };
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/**
 * date에서 days만큼 이전 날짜를 YYYY-MM-DD 형식으로 반환.
 */
function getDateOffset(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 트랜스크립트 텍스트를 MAX_TRANSCRIPT_CHARS 이하로 트런케이트한다.
 * null 입력 시 null 반환.
 */
function truncateTranscript(transcript: string | null): string | null {
  if (transcript == null) return null;
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  return `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}... (이하 생략)`;
}

/**
 * peer_groups 조회 결과에서 피어 목록을 추출하고,
 * 각 피어의 quarterly_ratios 최신 멀티플을 병렬로 조회한다.
 *
 * peer_groups 또는 피어 목록이 없으면 null을 반환한다.
 */
async function loadPeerGroupMultiples(
  peerGroupRows: PeerGroupRow[] | null,
  pool: Pool,
): Promise<Array<{ symbol: string; peRatio: number | null; evEbitda: number | null; psRatio: number | null }> | null> {
  const peerRow =
    peerGroupRows != null && peerGroupRows.length > 0 ? peerGroupRows[0] : null;

  if (peerRow == null || peerRow.peers == null || peerRow.peers.length === 0) {
    return null;
  }

  const peerSymbols = peerRow.peers;

  const peerRatioResults = await safeQuery<PeerRatiosRow>(
    () => findPeerRatios(peerSymbols, pool),
    "quarterly_ratios (peers)",
  );

  if (peerRatioResults == null || peerRatioResults.length === 0) {
    return null;
  }

  return peerRatioResults.map((row) => ({
    symbol: row.symbol,
    peRatio: toNumOrNull(row.pe_ratio),
    evEbitda: toNumOrNull(row.ev_ebitda),
    psRatio: toNumOrNull(row.ps_ratio),
  }));
}
